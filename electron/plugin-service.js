const fs = require('fs')
const path = require('path')
const os = require('os')

const PLUGIN_DIR = path.join(os.homedir(), '.ai-player', 'plugins')

function listPlugins() {
  if (!fs.existsSync(PLUGIN_DIR)) {
    try { fs.mkdirSync(PLUGIN_DIR, { recursive: true }) } catch {}
    return []
  }
  const plugins = []
  for (const file of fs.readdirSync(PLUGIN_DIR)) {
    if (file.endsWith('.js')) {
      try {
        delete require.cache[path.join(PLUGIN_DIR, file)]
        const plugin = require(path.join(PLUGIN_DIR, file))
        plugins.push({
          name: plugin.name || file,
          version: plugin.version || '1.0',
          description: plugin.description || '',
          tools: plugin.tools || [],
          file
        })
      } catch (e) {
        plugins.push({ name: file, error: String(e), file })
      }
    }
  }
  return plugins
}

module.exports = { listPlugins, PLUGIN_DIR }
