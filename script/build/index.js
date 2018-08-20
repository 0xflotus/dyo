const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const chokidar = require('chokidar')
const UglifyJS = require('uglify-js')
const UglifyES = require('uglify-es')
const package = require('../../package.json')

const bodyMarker = "'{{%body%}}'"
const fileMarker = "'{{%file%}}'"

const options = {compress: {}}
const strict = `/* eslint-disable */'use strict'`

const filenames = {
	development: {
		umd: 'dio.umd.development.js',
		esm: 'dio.esm.development.js',
		cjs: 'dio.cjs.development.js'
	},

	production: {
		umd: 'dio.umd.production.js',
		esm: 'dio.esm.production.js',
		cjs: 'dio.cjs.production.js'
	}
}

const shared = [
	'../../src/Core/Shared.js'
]

const core = [
	...shared,
	'../../src/Core/Check.js',
	'../../src/Core/Constant.js',
	'../../src/Core/Utility.js',
	'../../src/Core/Element.js',
	'../../src/Core/Children.js',
	'../../src/Core/Factory.js',
	'../../src/Core/Error.js',
	'../../src/Core/Event.js',
	'../../src/Core/Component.js',
	'../../src/Core/Lifecycle.js',
	'../../src/Core/Refs.js',
	'../../src/Core/Context.js',
	'../../src/Core/Find.js',
	'../../src/Core/Render.js',
	'../../src/Core/Commit.js',
	'../../src/Core/Reconcile.js',
	'../../src/Core/Node.js'
]

const cjs = [
	...shared,
	'../../src/Server/Utility.js',
	'../../src/Server/String.js',
	'../../src/Server/JSON.js',
	'../../src/Server/Stream.js',
	'../../src/Server/Render.js'
]

const client = [
	'../../src/Client/DOM.js'
]

const umd = [
	...core,
	...client
]

const esm = [
	...core,
	...client
]

const server = `
Object.defineProperties(Element.prototype, {
	toJSON: {value: toJSON},
	toString: {value: toString},
	toStream: {value: toStream}
})

dio.renderToString = renderToString
dio.renderToNodeStream = renderToNodeStream
`

/**
 * @return {string}
 */
const transform = (str) => {
	return str.replace(/,?\s*.*h\b.*:.*/g, '')
						.replace(/\s*(\w+):\s+\S+,?/gm, '$1,\n')
						.trim()
						.replace(/,$/, '')
}

const pad = (content, tabs) => {
	if (tabs > 1)
		return content.replace(/^/gm, '\t\t')
	else
		return content.replace(/^/gm, '\t')
}

const modulize = (content) => {
	return content + '\n' + api.replace(/(dio)\.(\w+).*/g, 'export var $2 = dio.$2') + '\nexport default dio'
}

const replaceNodeEnv = (code, productive) => {
	const replacement = productive ? "'production'" : "'development'"

	return code.replace(/process\.env\.NODE_ENV/g, replacement)
}

const factory = fs.readFileSync(path.join(__dirname, 'UMD.js'), 'utf8').trim()
const api = `
dio.render = render
dio.hydrate = hydrate
dio.Component = Component
dio.Fragment = Fragment
dio.PureComponent = PureComponent
dio.Children = Children
dio.createContext = createContext
dio.createFactory = createFactory
dio.cloneElement = cloneElement
dio.isValidElement = isValidElement
dio.createPortal = createPortal
dio.createElement = createElement
dio.createComment = createComment
dio.createClass = createClass
dio.createRef = createRef
dio.forwardRef = forwardRef
dio.unmountComponentAtNode = unmountComponentAtNode
dio.findDOMNode = findDOMNode
dio.h = createElement
`

const internals = `
dio,
Element,
mountComponentInstance,
delegateErrorBoundary,
getElementDefinition,
createElementSnapshot,
createElementEmpty,
createElement,
commitOwner
`.replace(/\s+/g, ' ').trim()

const template = `
/* istanbul ignore next */

if (typeof module === 'function') module(${internals})
`.trim()

const parse = (head, body, tail, factory, productive) => {
	if (factory.indexOf(bodyMarker) === -1 || factory.indexOf(fileMarker) === -1)
		throw 'invalid umd wrapper'

	const file =
		productive	
			? './dio.cjs.production.js'
			: './dio.cjs.development.js'

	return factory
			.replace(bodyMarker,'\n'+pad(head+body+tail, 2))
			.replace(fileMarker, `'${file}'`)
}

const builder = (file) => {
	return fs.readFileSync(path.join(__dirname, file), 'utf8')
}

const wrapper = (module, content, factory, version, license, productive) => {
	var head = `var dio = {version: '${version}'}\n\n`
	var expo = '\n'+api.trim()
	var temp = '\n\nreturn dio'

	switch (module) {
		case 'cjs': {
			return {
				head: comment(version, license),
				body: 'module.exports = function ('+(internals)+') {'+strict+
					'\n\n'+pad(content.trim()+'\n\n'+server.trim())+'\n}',
				tail: '/*!/dio*/'
			}
		}
		case 'esm':
			return {
				head: comment(version, license),
				body: parse(head, content, expo+temp, modulize(factory), productive),
				tail: '/*!/dio*/'
			}
		default:
			return {
				head: comment(version, license),
				body: parse(head, content, expo+'\n\n'+template+temp, factory, productive),
				tail: '/*!/dio*/'
			}
	}
}

const comment = (version, license) => {
	return `/*!dio ${version} @license MIT */\n`
}

const bundle = (module, files, location, productive) => {
	const
		version = package.version,
		license = package.license,
		filename = filenames[productive ? 'production' : 'development'][module],
		filepath = location+filename,
		factory = fs.readFileSync(path.join(__dirname, 'UMD.js'), 'utf8').trim(),

		contentParts =
			wrapper(module, files.map(builder).join('\n'), factory, version, license, productive),

		content = (
			contentParts.head
			+ replaceNodeEnv(contentParts.body, productive)
			+ '\n' + contentParts.tail
		).trim()+'\n'

	fs.writeFileSync(path.join(__dirname, filepath), content)

	switch (module) {
		case 'esm':
			minify(UglifyES, {content, filename, module, filepath}, false)
			break
		case 'cjs':
			minify(UglifyJS, {content, filename, module, filepath}, false)
			break
		case 'umd':
			minify(UglifyJS, {content, filename, module, filepath}, productive)
			break
		default:
			throw new Error('Illegal module type: ' + module)
	}
}

const minify = (uglify, {content, module, filename, filepath}, determineGzipFileSize) => {
	const
		min = filepath.replace('.js', '.min.js'),
		map = min.replace('.js', '.js.map'),

		compressed = uglify.minify({[filename]: content}, {
			sourceMap: {
				filename: filename,
				url: filename.replace('.js', '.min.js.map')
			}
		})

	if (compressed.error) {
		const {message, filename, line, col} = compressed.error

		return console.error(message, filename, `${line}:${col}`)
	}

	if (determineGzipFileSize) {
		gzipsize(compressed.code)
	}

	fs.writeFileSync(path.join(__dirname, min), compressed.code)
	fs.writeFileSync(path.join(__dirname, map), compressed.map)
}

const estimate = (num) => {
	return '~'+num+'kb'
}

const gzipsize = (content) => {
	const
		size = parseInt(zlib.gzipSync(content, {level: 9}).length)/1000,
		kbSize = '~'+Math.trunc(size+.1)+'kb',
		readpath = path.join(__dirname, '../../README.md')

	fs.writeFileSync(readpath, fs.readFileSync(readpath).toString().replace(/(-\s+)~?\d+kb/, '$1'+kbSize))

	console.log('\ngzip: ~'+size+'kb')
}

const resolve = () => {
	const distPath = path.join(__dirname, '../../dist')

	if (!fs.existsSync(distPath)) {
		fs.mkdirSync(distPath)
	}

	// development bundles
	bundle('umd', umd, '../../dist/', false)
	bundle('cjs', cjs, '../../dist/', false)
	bundle('esm', esm, '../../dist/', false)

	// production bundles
	bundle('umd', umd, '../../dist/', true)
	bundle('cjs', cjs, '../../dist/', true)
	bundle('esm', esm, '../../dist/', true)

	console.log('build complete..')
}

if ((process.argv.pop()+'').indexOf('watch') < 0) {
	return resolve()
}

const watcher = (file) => {
	if (!file) {
		console.log('\nwatching..', 'src/')
	} else {
		if (file.indexOf('package.json') > -1) {
			delete require.cache[require.resolve('../../package.json')]
			Object.assign(package, require('../../package.json'))
		}
		console.log('\nchanged: ' + file)
	}

	resolve()
}

const watch = chokidar.watch([
	'./script/build/UMD.js',
	'./src/',
	'./package.json',
	], {ignored: /[\/\\]\./})

watch.on('change', watcher)
watch.on('ready', watcher)
