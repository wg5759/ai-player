// 回归验收：控制栏 3 秒自动隐藏 + 鼠标微抖不唤醒 + 真实移动唤醒
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executableArg = process.argv.slice(2).find((value) => value.startsWith('--exe='))
const mediaArg = process.argv.slice(2).find((value) => !value.startsWith('--'))
const executable = executableArg ? path.resolve(executableArg.slice('--exe='.length)) : path.join(root, 'release', 'win-unpacked', 'AI播放器.exe')
const mediaPath = mediaArg || 'D:/Ai工具升级/测试视频-120秒.mp4'
const port = 19451
const child = spawn(executable, [`--remote-debugging-port=${port}`, mediaPath], { windowsHide: true, shell: false })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

let websocket
let nextId = 0
const pending = new Map()
function command(method, params = {}) {
  const id = ++nextId
  websocket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve) => pending.set(id, { resolve }))
}
async function opacity() {
  const result = await command('Runtime.evaluate', {
    expression: `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('媒体库')); return b ? getComputedStyle(b).opacity : 'missing' })()`,
    returnByValue: true
  })
  return result.result?.value
}
async function moveMouse(x, y) {
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
}

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}：期望 ${expected}，实际 ${actual}`)
}

try {
  let page
  for (let i = 0; i < 80 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === 'page') } catch {}
    if (!page) await delay(250)
  }
  if (!page) throw new Error('页面未就绪')
  websocket = new WebSocket(page.webSocketDebuggerUrl)
  websocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id).resolve(message.result); pending.delete(message.id) }
  })
  await new Promise((res, rej) => { websocket.addEventListener('open', res, { once: true }); websocket.addEventListener('error', rej, { once: true }) })
  await command('Page.bringToFront')
  await command('Emulation.setFocusEmulationEnabled', { enabled: true })
  await delay(6000) // 等播放稳定 + 首个隐藏窗口

  check('播放中静止 3 秒后控制栏已隐藏', await opacity(), '0')

  // 鼠标微抖（±1px）持续 5 秒：不应唤醒
  for (let i = 0; i < 10; i++) {
    await moveMouse(500 + (i % 2), 300)
    await delay(500)
  }
  check('鼠标 ±1px 微抖后控制栏仍隐藏', await opacity(), '0')

  // 真实移动（>4px）：应唤醒
  await moveMouse(500, 300)
  await moveMouse(540, 330)
  await delay(600)
  check('真实移动后控制栏重新显示', await opacity(), '1')

  // 再次静止：3 秒后应重新隐藏
  await delay(3600)
  check('再次静止后控制栏重新隐藏', await opacity(), '0')

  console.log(failures === 0 ? 'SMOKE_OK 控制栏自动隐藏与鼠标阈值全部通过' : `SMOKE_FAIL ${failures} 项未过`)
} finally {
  try { websocket?.close() } catch {}
  try { child.kill() } catch {}
}
process.exit(failures === 0 ? 0 : 1)
