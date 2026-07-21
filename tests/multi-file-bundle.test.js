const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ExcelJS = require('exceljs')
const JSZip = require('jszip')
const { DocumentWorkspaceService, classifyTask, normalizeBundlePlan } = require('../electron/document-workspace-service')

test('联合任务识别：多格式+连接词成套；单输出不误判', () => {
  const files = [{ path: '资料.txt' }]
  const three = classifyTask(files, '把这些资料做成一套：Word 报告 + Excel 分析表 + PPT 汇报', 'auto')
  assert.equal(three.kind, 'ai-bundle')
  assert.equal(three.requiresAi, true)
  assert.deepEqual(three.bundleFormats.sort(), ['docx', 'pptx', 'xlsx'].sort())
  assert.equal(classifyTask(files, '整理成Word报告和PDF交付版', 'auto').kind, 'ai-bundle')
  assert.equal(classifyTask(files, '把PDF里的内容整理成Word', 'auto').kind, 'ai-generate')
  assert.equal(classifyTask([{ path: 'a.docx' }], '提取文字并改成pdf', 'auto').kind, 'convert')
  assert.equal(classifyTask(files, '整理成 Word 文档', 'auto').kind, 'ai-generate')
})

test('normalizeBundlePlan 只保留被请求的格式并校验结构', () => {
  const bundle = normalizeBundlePlan({
    title: '季度成套',
    summary: '完成',
    docx: { title: '季度报告', content: '# 概述\n- 要点' },
    xlsx: { sheets: [{ name: '数据', rows: [['月份', '收入'], ['1月', 100]] }] },
    pdf: { title: '交付版', content: '正文' },
    txt: { content: '不应出现' }
  }, ['docx', 'xlsx', 'pdf'])
  assert.deepEqual(Object.keys(bundle.sections).sort(), ['docx', 'pdf', 'xlsx'].sort())
  assert.equal(bundle.sections.xlsx.sheets[0].rows[1][1], 100)
  assert.throws(() => normalizeBundlePlan({ title: '空' }, ['docx']), /没有给出任何可用的成套内容/)
})

test('联合任务端到端：一次模型调用产出成套文件并记录历史', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-e2e-'))
  try {
    const sourcePath = path.join(tempDir, '销售资料.txt')
    fs.writeFileSync(sourcePath, '1月收入100，成本80；2月收入200，成本150。')
    const bundleJson = JSON.stringify({
      title: '销售成套',
      summary: '已生成销售成套成果',
      docx: { title: '销售报告', content: '# 销售概况\n- 1月毛利20\n- 2月毛利50' },
      xlsx: { sheets: [{ name: '月度数据', rows: [['月份', '收入', '成本'], ['1月', 100, 80], ['2月', 200, 150]] }] },
      pptx: { slides: [{ title: '销售概览', bullets: ['总收入300', '总毛利70'], notes: '开场白' }] },
      pdf: { title: '销售交付版', content: '交付正文' }
    })
    const service = new DocumentWorkspaceService({
      outputRoot: path.join(tempDir, 'outputs'),
      historyRoot: path.join(tempDir, 'history'),
      complete: async ({ prompt }) => {
        assert.match(prompt, /需要产出：docx、xlsx、pptx、pdf/)
        return { text: bundleJson }
      },
      renderPdf: async (html, finalPath) => fs.writeFileSync(finalPath, '%PDF-1.4\n%%EOF\n')
    })
    const result = await service.run([sourcePath], '把资料做成一套：Word 报告 + Excel 分析表 + PPT 汇报 + PDF 交付版', 'auto')
    assert.equal(result.success, true)
    assert.equal(result.plan.kind, 'ai-bundle')
    assert.equal(result.outputs.length, 4)
    assert.ok(result.outputs.every((output) => fs.existsSync(output)))
    assert.match(result.summary, /共 4 个文件/)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(result.outputs.find((output) => output.endsWith('.xlsx')))
    assert.equal(workbook.getWorksheet('月度数据').getCell('C3').value, 150)

    const pptxPath = result.outputs.find((output) => output.endsWith('.pptx'))
    const archive = await JSZip.loadAsync(fs.readFileSync(pptxPath))
    const slideXml = await archive.file('ppt/slides/slide1.xml').async('string')
    assert.ok(slideXml.includes('销售概览'))

    const history = fs.readFileSync(path.join(tempDir, 'history', 'history.jsonl'), 'utf8')
    assert.match(history, /ai-bundle/)
    assert.equal(history.trim().split('\n').length, 1)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('无源文件也能按指令成套生成', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-nofiles-'))
  try {
    const service = new DocumentWorkspaceService({
      outputRoot: path.join(tempDir, 'outputs'),
      historyRoot: path.join(tempDir, 'history'),
      complete: async () => ({
        text: JSON.stringify({
          title: '周报成套',
          summary: '完成',
          docx: { title: '周报', content: '# 本周进展' },
          md: { content: '# 周报 md' }
        })
      }),
      renderPdf: async () => { throw new Error('不应渲染 PDF') }
    })
    const result = await service.run([], '生成本周工作周报，要 Word 和 Markdown 两份', 'auto')
    assert.equal(result.success, true)
    assert.equal(result.outputs.length, 2)
    assert.ok(result.outputs.some((output) => output.endsWith('.docx')))
    assert.ok(result.outputs.some((output) => output.endsWith('.md')))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
