const fs = require('fs')
const path = require('path')
const { fileURLToPath } = require('url')
const { ALL_EXTS } = require('./file-service')

function normalizeExternalPath(value) {
  if (typeof value !== 'string') return null
  let candidate = value.trim()
  if (!candidate || candidate.startsWith('--')) return null
  if (candidate.length >= 2 && candidate.startsWith('"') && candidate.endsWith('"')) {
    candidate = candidate.slice(1, -1)
  }
  if (/^file:\/\//i.test(candidate)) {
    try { candidate = fileURLToPath(candidate) } catch { return null }
  }
  return path.resolve(candidate)
}

function extractExternalMediaPaths(argv, options = {}) {
  const existsSync = options.existsSync || fs.existsSync
  const statSync = options.statSync || fs.statSync
  const allowedExtensions = new Set(options.allowedExtensions || ALL_EXTS)
  const found = []
  const seen = new Set()
  for (const value of Array.isArray(argv) ? argv : []) {
    const candidate = normalizeExternalPath(value)
    if (!candidate || !allowedExtensions.has(path.extname(candidate).toLowerCase())) continue
    const identity = process.platform === 'win32' ? candidate.toLowerCase() : candidate
    if (seen.has(identity)) continue
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
    } catch {
      continue
    }
    seen.add(identity)
    found.push(candidate)
  }
  return found
}

const DOCUMENT_VERB_FLAG = '--agentplay-documents'

function hasDocumentVerbFlag(argv) {
  return (Array.isArray(argv) ? argv : []).some(
    (value) => String(value || '').trim().toLowerCase() === DOCUMENT_VERB_FLAG
  )
}

// Paths handed over through the Explorer "用 AgentPlay 智能处理" verb. Only
// arguments after the flag are considered so the executable path and other
// switches in the command line can never be mistaken for documents.
function extractDocumentVerbPaths(argv, options = {}) {
  const list = Array.isArray(argv) ? argv : []
  const flagIndex = list.findIndex(
    (value) => String(value || '').trim().toLowerCase() === DOCUMENT_VERB_FLAG
  )
  if (flagIndex === -1) return []
  return extractExternalMediaPaths(list.slice(flagIndex + 1), options)
}

module.exports = {
  extractExternalMediaPaths,
  normalizeExternalPath,
  DOCUMENT_VERB_FLAG,
  hasDocumentVerbFlag,
  extractDocumentVerbPaths
}
