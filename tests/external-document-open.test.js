const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  DOCUMENT_VERB_FLAG,
  hasDocumentVerbFlag,
  extractDocumentVerbPaths,
  extractExternalMediaPaths
} = require('../electron/external-media-open')

test('document verb flag is detected case-insensitively and only as a full argument', () => {
  assert.equal(DOCUMENT_VERB_FLAG, '--agentplay-documents')
  assert.equal(hasDocumentVerbFlag([]), false)
  assert.equal(hasDocumentVerbFlag(['C:\\docs\\a.docx']), false)
  assert.equal(hasDocumentVerbFlag(['--agentplay-documents=x']), false)
  assert.equal(hasDocumentVerbFlag(['--agentplay-documents']), true)
  assert.equal(hasDocumentVerbFlag(['C:\\app\\AI播放器.exe', ' --AGENTPLAY-DOCUMENTS ']), true)
})

test('document verb extraction only accepts existing files after the flag', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentplay-verb-'))
  try {
    const docxPath = path.join(tempDir, '销售 报表.docx')
    const txtPath = path.join(tempDir, '笔记.txt')
    const exeDisguise = path.join(tempDir, 'launcher.docx')
    fs.writeFileSync(docxPath, 'doc')
    fs.writeFileSync(txtPath, 'txt')
    fs.writeFileSync(exeDisguise, 'exe')
    const allowedExtensions = ['.docx', '.txt']

    assert.deepEqual(extractDocumentVerbPaths([docxPath], { allowedExtensions }), [])

    const found = extractDocumentVerbPaths([
      exeDisguise,
      '--agentplay-documents',
      docxPath,
      docxPath,
      path.join(tempDir, '不存在.docx'),
      path.join(tempDir, '压缩包.zip'),
      txtPath,
      '--agentplay-other-flag'
    ], { allowedExtensions })
    assert.deepEqual(found, [docxPath, txtPath].map((p) => path.resolve(p)))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('document formats are valid player inputs, so the verb guard in main.js is mandatory', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentplay-verb-guard-'))
  try {
    const docxPath = path.join(tempDir, '报告.docx')
    fs.writeFileSync(docxPath, 'doc')
    // .docx is part of ALL_EXTS (media library documents), so without the
    // hasDocumentVerbFlag guard a verb launch would be sent to the player.
    assert.equal(extractExternalMediaPaths([docxPath]).length, 1)
    const argv = ['C:\\app\\AI播放器.exe', '--agentplay-documents', docxPath]
    assert.equal(hasDocumentVerbFlag(argv), true)
    assert.deepEqual(extractDocumentVerbPaths(argv), [path.resolve(docxPath)])
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
