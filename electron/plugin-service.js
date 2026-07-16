const fs = require('fs')
const path = require('path')
const os = require('os')
const vm = require('vm')

const PLUGIN_DIR = path.join(os.homedir(), '.ai-player', 'plugins')

const SAFE_API = {
  console: { log: console.log, error: console.error, warn: console.warn },
  setTimeout, setInterval, clearTimeout, clearInterval,
  JSON, Math, Date, String, Number, Boolean, Array, Object,
  RegExp, Error, Promise, Buffer
}

function loadPluginSafely(filePath, file) {
  const code = fs.readFileSync(filePath, 'utf-8')
  const sandbox = { module: { exports: {} }, exports: {}, ...SAFE_API }
  sandbox.module.exports = sandbox.exports
  try {
    vm.createContext(sandbox)
    vm.runInContext(code, sandbox, { timeout: 3000, filename: file })
    const plugin = sandbox.module.exports || sandbox.exports
    if (!plugin || typeof plugin !== 'object') {
      return { name: file, error: '插件未导出对象', file }
    }
    return {
      name: plugin.name || file,
      version: plugin.version || '1.0',
      description: plugin.description || '',
      tools: plugin.tools || [],
      file
    }
  } catch (e) {
    return { name: file, error: String(e), file }
  }
}

function listPlugins() {
  if (!fs.existsSync(PLUGIN_DIR)) {
    try { fs.mkdirSync(PLUGIN_DIR, { recursive: true }) } catch {}
    return []
  }
  const plugins = []
  for (const file of fs.readdirSync(PLUGIN_DIR)) {
    if (file.endsWith('.js')) {
      plugins.push(loadPluginSafely(path.join(PLUGIN_DIR, file), file))
    }
  }
  return plugins
}

module.exports = { listPlugins, PLUGIN_DIR }
