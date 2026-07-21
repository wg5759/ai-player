// 正式 EXE 冒烟：验证打包应用的 Chromium（PDFium）能渲染 PDF 页面，是扫描件 OCR 栅格化的前提。
// 用法：node scripts/smoke-pdf-render.cjs [exe路径]
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { PDFDocument, rgb } = require('pdf-lib')

const root = path.resolve(__dirname, '..')
const executable = process.argv[2] || path.join(root, 'release', 'win-unpacked', 'AI播放器.exe')
const port = 19355

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function main() {
  if (!fs.existsSync(executable)) throw new Error(`缺少被验收 EXE：${executable}`)
  const probePdf = path.join(os.tmpdir(), 'agentplay-pdf-probe.pdf')
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  page.drawRectangle({ x: 50, y: 500, width: 500, height: 200, color: rgb(0, 0, 0) })
  page.drawText('OCR PROBE MARKER', { x: 60, y: 450, size: 24 })
  fs.writeFileSync(probePdf, await doc.save())

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentplay-probe-profile-'))
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`], { windowsHide: true, shell: false })
  let ws
  try {
    let page
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        page = pages.find((item) => item.type === 'page')
        if (page?.webSocketDebuggerUrl) break
      } catch { /* CDP 尚未就绪 */ }
      await delay(250)
    }
    if (!page) throw new Error('正式 EXE 没有在 20 秒内开放 CDP 页面')
    ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    let nextId = 0
    const pending = new Map()
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      }
    }
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, (message) => (message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
    await command('Page.navigate', { url: `file:///${probePdf.replace(/\\/g, '/')}` })
    await delay(3000)
    const shot = await command('Page.captureScreenshot', { format: 'png' })
    const buffer = Buffer.from(shot.data, 'base64')
    if (buffer.length < 15000) throw new Error(`截图疑似空白（${buffer.length} 字节），PDF 渲染不可用`)
    process.stdout.write(`PDF-RENDER-OK screenshot=${buffer.length}B\n`)
  } finally {
    try { ws?.close() } catch { /* 忽略 */ }
    child.kill()
    await delay(1500)
    fs.rmSync(probePdf, { force: true })
    try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch { /* 进程退出滞后导致的清理失败可忽略 */ }
  }
}

main().catch((error) => {
  console.error('PDF-RENDER-FAIL:', error)
  process.exit(1)
})
