const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { PDFDocument } = require('pdf-lib')
const { extractText } = require('../electron/document-workspace-service')
const { WinRtOcrService, normalizeOcrText } = require('../electron/ocr-service')

const execFileAsync = promisify(execFile)

async function imageOnlyPdf(filePath) {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  fs.writeFileSync(filePath, await doc.save())
}

test('OCR 文本规整：压缩 CJK 与数字之间的空格，保留拉丁词间空格', () => {
  assert.equal(normalizeOcrText('商 标 注 册 证 注 册 人 ： 张 三'), '商标注册证注册人：张三')
  assert.equal(normalizeOcrText('有 效 期 至 2 0 3 5 年 1 2 月'), '有效期至2035年12月')
  assert.equal(normalizeOcrText('第 30 类 咖 啡'), '第30类咖啡')
})

test('扫描 PDF 在无文字层时回退 OCR；OCR 为空或缺失时保持诚实报错', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-ocr-fallback-'))
  try {
    const pdfPath = path.join(tempDir, '扫描件.pdf')
    await imageOnlyPdf(pdfPath)
    const text = await extractText(pdfPath, { recognizePdf: async () => '  第 1 页：注册人张三  ' })
    assert.match(text, /第 1 页：注册人张三/)
    assert.match(text, /扫描件.*OCR/)
    await assert.rejects(
      () => extractText(pdfPath, { recognizePdf: async () => '' }),
      /没有可提取的文字层/
    )
    await assert.rejects(() => extractText(pdfPath), /没有可提取的文字层/)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('recognize 解析 WinRT 脚本的协议输出，容忍单张失败', async () => {
  const script = [
    '###IMAGE C:\\a.png',
    '###TEXT',
    '商 标 注 册 证',
    '###END',
    '###IMAGE C:\\b.png',
    '###ERROR 无法读取图片',
    '###END'
  ].join('\r\n')
  const fakeSpawn = () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    process.nextTick(() => {
      child.stdout.emit('data', Buffer.from(script, 'utf8'))
      child.emit('close', 0)
    })
    return child
  }
  const service = new WinRtOcrService({ scriptPath: 'x.ps1', spawnImpl: fakeSpawn })
  const results = await service.recognize(['C:\\a.png', 'C:\\b.png'], { lang: '' })
  assert.equal(results.get('C:\\a.png').ok, true)
  assert.equal(results.get('C:\\a.png').text, '商标注册证')
  assert.equal(results.get('C:\\b.png').ok, false)
  assert.match(results.get('C:\\b.png').error, /无法读取图片/)
})

test('Windows 系统 OCR 端到端识别中文图片（仅 Windows 且识别语言可用）', async (t) => {
  if (process.platform !== 'win32') return t.skip('仅 Windows 可运行系统 OCR')
  const service = new WinRtOcrService()
  const status = await service.detect()
  if (!status.available) return t.skip(`本机系统 OCR 不可用：${status.reason}`)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-ocr-e2e-'))
  try {
    const pngPath = path.join(tempDir, 'sample.png')
    const ps = [
      'Add-Type -AssemblyName System.Drawing',
      '$bmp = New-Object System.Drawing.Bitmap 1240, 420',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.Clear([System.Drawing.Color]::White)',
      "$font = New-Object System.Drawing.Font('Microsoft YaHei', 48)",
      "$g.DrawString('商标注册证 注册人：张三', $font, [System.Drawing.Brushes]::Black, 40, 40)",
      `$bmp.Save('${pngPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      '$g.Dispose(); $bmp.Dispose()'
    ].join('; ')
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps])
    const results = await service.recognize([pngPath])
    const entry = results.get(pngPath)
    assert.equal(entry.ok, true)
    assert.match(entry.text, /商标/)
    assert.match(entry.text, /张三/)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
