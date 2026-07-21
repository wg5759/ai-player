const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ExcelJS = require('exceljs')
const { analyzeFormula, evaluateFormula } = require('../electron/formula-engine')
const { DocumentWorkspaceService } = require('../electron/document-workspace-service')

function grid(values) {
  return (ref) => values[`${ref.column}${ref.row}`] ?? 0
}

test('formula engine evaluates arithmetic, percent, power and comparisons', () => {
  assert.equal(evaluateFormula('=1+2*3', grid({})), 7)
  assert.equal(evaluateFormula('=(D2-E2)/D2', grid({ D2: 25, E2: 20 })), 0.2)
  assert.equal(evaluateFormula('=-5%', grid({})), -0.05)
  assert.equal(evaluateFormula('=2^10', grid({})), 1024)
  assert.equal(evaluateFormula('=IF(D2>10,"高","低")', grid({ D2: 25 })), '高')
  assert.equal(evaluateFormula('=IF(A1="是",1,0)', grid({ A1: '是' })), 1)
})

test('formula engine evaluates IFERROR, rounding and aggregates over ranges', () => {
  assert.equal(evaluateFormula('=IFERROR((D2-E2)/D2,0)', grid({ D2: 0, E2: 50 })), 0)
  assert.throws(() => evaluateFormula('=(D2-E2)/D2', grid({ D2: 0, E2: 50 })), /#DIV\/0!/)
  assert.equal(evaluateFormula('=ROUND(3.14159,2)', grid({})), 3.14)
  assert.equal(evaluateFormula('=SUM(A1:A3)', grid({ A1: 1, A2: 2, A3: 3 })), 6)
  assert.equal(evaluateFormula('=AVERAGE(A1:A3)', grid({ A1: 10, A2: 20, A3: 60 })), 30)
  assert.equal(evaluateFormula('=MAX(A1:A3)', grid({ A1: 1, A2: 9, A3: 3 })), 9)
  assert.equal(evaluateFormula('=MIN(A1:A3)', grid({ A1: 1, A2: 9, A3: 3 })), 1)
  assert.equal(evaluateFormula('=COUNT(A1:A3)', grid({ A1: 1, A2: '文本', A3: 3 })), 2)
})

test('formula engine refuses unknown functions and reports formula structure', () => {
  assert.throws(() => evaluateFormula('=VLOOKUP(D2,A1:B9,2)', grid({ D2: 1 })), /超出本地重算能力/)
  const analysis = analyzeFormula('=IFERROR((D2-E2)/D2,0)+SUM(G1:G9)')
  assert.deepEqual([...new Set(analysis.cellRefs.map((ref) => ref.column))].sort(), ['D', 'E', 'G'])
  assert.deepEqual(analysis.unsupported, [])
  assert.equal(analyzeFormula('=WEBSERVICE("http://x")').unsupported.length > 0, true)
})

async function buildSalesWorkbook(filePath, rows) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('数据')
  sheet.addRow(['月份', '名称', '编号', '收入', '成本'])
  for (const row of rows) sheet.addRow(row)
  await workbook.xlsx.writeFile(filePath)
}

function localService(tempDir) {
  return new DocumentWorkspaceService({
    outputRoot: path.join(tempDir, 'outputs'),
    historyRoot: path.join(tempDir, 'history'),
    complete: async () => { throw new Error('不应调用模型') },
    renderPdf: async () => { throw new Error('不应渲染 PDF') }
  })
}

test('written formulas are recalculated against real data and reported with samples', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recalc-ok-'))
  try {
    const filePath = path.join(tempDir, '销售.xlsx')
    await buildSalesWorkbook(filePath, [
      ['1月', 'a', 1, 100, 80],
      ['2月', 'b', 2, 200, 150],
      ['3月', 'c', 3, 0, 50]
    ])
    const result = await localService(tempDir).run([filePath], '在 G 列填入公式：=IFERROR((D2-E2)/D2,0)', 'auto')
    assert.equal(result.success, true)
    assert.match(result.summary, /重算抽验 3 行通过/)
    assert.match(result.summary, /G2=0\.2/)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(result.outputs[0])
    const cell = workbook.getWorksheet('数据').getCell('G2')
    assert.equal(cell.value.formula, 'IFERROR((D2-E2)/D2,0)')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('recalculation surfaces real data errors instead of passing silently', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recalc-div0-'))
  try {
    const filePath = path.join(tempDir, '销售.xlsx')
    await buildSalesWorkbook(filePath, [
      ['1月', 'a', 1, 100, 80],
      ['3月', 'c', 3, 0, 50]
    ])
    const result = await localService(tempDir).run([filePath], '在 G 列填入公式：=(D2-E2)/D2', 'auto')
    assert.equal(result.success, true)
    assert.match(result.summary, /计算错误/)
    assert.match(result.summary, /#DIV\/0!/)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('circular references are rejected before writing anything', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recalc-circular-'))
  try {
    const filePath = path.join(tempDir, '销售.xlsx')
    await buildSalesWorkbook(filePath, [['1月', 'a', 1, 100, 80]])
    await assert.rejects(() => localService(tempDir).run([filePath], '在 G 列填入公式：=G2+1', 'auto'), /循环引用/)
    await assert.rejects(() => localService(tempDir).run([filePath], '在 G 列填入公式：=SUM(D2:G2)', 'auto'), /循环引用/)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('unsupported functions are written but honestly marked as not locally verifiable', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recalc-vlookup-'))
  try {
    const filePath = path.join(tempDir, '销售.xlsx')
    await buildSalesWorkbook(filePath, [['1月', 'a', 1, 100, 80]])
    const result = await localService(tempDir).run([filePath], '在 G 列填入公式：=VLOOKUP(D2,A1:B9,2)', 'auto')
    assert.equal(result.success, true)
    assert.match(result.summary, /VLOOKUP 超出本地重算能力/)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(result.outputs[0])
    assert.equal(workbook.getWorksheet('数据').getCell('G2').value.formula, 'VLOOKUP(D2,A1:B9,2)')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
