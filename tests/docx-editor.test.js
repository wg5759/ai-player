const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const JSZip = require('jszip')
const mammoth = require('mammoth')
const { Document, Footer, Header, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } = require('docx')
const { editDocx, parseEditInstruction } = require('../electron/docx-editor')
const { DocumentWorkspaceService, classifyTask } = require('../electron/document-workspace-service')

async function buildComplexFixture(filePath) {
  const doc = new Document({
    sections: [{
      headers: { default: new Header({ children: [new Paragraph('机密页眉2026')] }) },
      footers: { default: new Footer({ children: [new Paragraph('第 1 页共 N 页')] }) },
      children: [
        new Paragraph({ text: '合作框架协议', heading: HeadingLevel.TITLE }),
        new Paragraph({
          children: [
            new TextRun({ text: '甲方：', bold: true }),
            new TextRun({ text: '张' }),
            new TextRun({ text: '三（', italics: true }),
            new TextRun({ text: '身份证号略）' })
          ]
        }),
        new Table({
          rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph('条款')] }), new TableCell({ children: [new Paragraph('内容')] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph('价格')] }), new TableCell({ children: [new Paragraph('100元')] })] })
          ]
        }),
        new Paragraph('其他约定事项保持不变。')
      ]
    }]
  })
  fs.writeFileSync(filePath, await Packer.toBuffer(doc))
}

test('parseEditInstruction reads replace and append, rejects conversion and translation phrasing', () => {
  assert.deepEqual(parseEditInstruction('把张三替换成李四'), [{ type: 'replace', from: '张三', to: '李四' }])
  assert.deepEqual(parseEditInstruction('把合同里的"价格"改为"200元"'), [{ type: 'replace', from: '合同里的价格', to: '200元' }])
  assert.equal(parseEditInstruction('把文档改成pdf'), null)
  assert.equal(parseEditInstruction('提取文字并改成pdf'), null)
  assert.equal(parseEditInstruction('把内容改成英文'), null)
  const append = parseEditInstruction('在文档末尾追加：第三条 双方另行约定')
  assert.equal(append[0].type, 'append')
  assert.ok(append[0].lines.join(' ').includes('第三条'))
})

test('classifyTask routes deterministic docx edits local and keeps convert/translation behavior', () => {
  const doc = [{ path: '合同.docx' }]
  assert.deepEqual(classifyTask(doc, '把合同里的张三替换成李四', 'auto'), {
    kind: 'docx-edit',
    outputFormat: 'docx',
    requiresAi: false,
    summary: '本地无损编辑 DOCX',
    editOperations: [{ type: 'replace', from: '合同里的张三', to: '李四' }]
  })
  assert.equal(classifyTask(doc, '提取文字并改成pdf', 'auto').kind, 'convert')
  assert.equal(classifyTask(doc, '把内容改成英文', 'auto').requiresAi, true)
})

test('editDocx replaces text spanning runs and appends, leaving styles, table, header and footer intact', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-edit-'))
  try {
    const fixture = path.join(tempDir, '合同.docx')
    const output = path.join(tempDir, '合同-out.docx')
    await buildComplexFixture(fixture)
    const originalBytes = fs.readFileSync(fixture)

    const summary = await editDocx(fixture, output, [
      { type: 'replace', from: '张三', to: '李四' },
      { type: 'append', lines: ['# 补充条款', '第一条 本条款为测试追加。'] }
    ])
    assert.match(summary, /替换 1 处/)

    const [before, after] = await Promise.all([JSZip.loadAsync(originalBytes), JSZip.loadAsync(fs.readFileSync(output))])
    const beforeDoc = await before.file('word/document.xml').async('string')
    const afterDoc = await after.file('word/document.xml').async('string')
    assert.notEqual(afterDoc, beforeDoc)
    const visible = [...afterDoc.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('')
    assert.ok(visible.includes('李四'))
    assert.ok(!visible.includes('张三'))
    assert.ok(visible.includes('补充条款'))
    assert.ok(visible.includes('第一条 本条款为测试追加。'))
    assert.ok(afterDoc.includes('<w:tbl>'), '表格结构必须保留')
    assert.ok(afterDoc.includes('Heading1'), '追加标题使用 Heading1 样式')

    for (const name of ['word/styles.xml', 'word/header1.xml', 'word/footer1.xml']) {
      const beforeEntry = before.file(name)
      const afterEntry = after.file(name)
      if (!beforeEntry) continue
      assert.equal(await afterEntry.async('string'), await beforeEntry.async('string'), `${name} 必须逐字不变`)
    }

    const text = await mammoth.extractRawText({ path: output })
    assert.ok(text.value.includes('李四'))
    assert.ok(text.value.includes('补充条款'))
    assert.deepEqual(fs.readFileSync(fixture), originalBytes, '原文件不得被改动')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('service.run executes a docx edit task fully local and records history', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-edit-run-'))
  try {
    const fixture = path.join(tempDir, '合同.docx')
    await buildComplexFixture(fixture)
    const service = new DocumentWorkspaceService({
      outputRoot: path.join(tempDir, 'outputs'),
      historyRoot: path.join(tempDir, 'history'),
      complete: async () => { throw new Error('不应调用模型') },
      renderPdf: async () => { throw new Error('不应渲染 PDF') }
    })
    const result = await service.run([fixture], '把合同里的张三替换成李四；在文档末尾追加：补充条款如下', 'auto')
    assert.equal(result.success, true)
    assert.equal(result.plan.kind, 'docx-edit')
    assert.equal(result.plan.requiresAi, false)
    assert.ok(result.outputs[0].endsWith('-AgentPlay处理版.docx'))
    const text = await mammoth.extractRawText({ path: result.outputs[0] })
    assert.ok(text.value.includes('李四'))
    assert.ok(text.value.includes('补充条款'))
    const history = fs.readFileSync(path.join(tempDir, 'history', 'history.jsonl'), 'utf8')
    assert.match(history, /docx-edit/)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('missing replacement text fails without touching the original file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-edit-miss-'))
  try {
    const fixture = path.join(tempDir, '合同.docx')
    const output = path.join(tempDir, '合同-out.docx')
    await buildComplexFixture(fixture)
    const originalBytes = fs.readFileSync(fixture)
    await assert.rejects(() => editDocx(fixture, output, [{ type: 'replace', from: '不存在的名字', to: '李四' }]), /没有找到要替换的文字/)
    assert.equal(fs.existsSync(output), false)
    assert.deepEqual(fs.readFileSync(fixture), originalBytes)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
