const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const DEFAULT_LANG = 'zh-Hans-CN'
const BATCH_TIMEOUT_MS = 180000

// Windows 系统 OCR 输出的 CJK/数字字符之间常带空格，压缩掉；
// 拉丁字母与数字之间、拉丁单词之间保留正常空格。
const CJK_CHAR = '[\\u4E00-\\u9FFF\\u3000-\\u303F\\uFF00-\\uFFEF]'

function normalizeOcrText(text) {
  return String(text || '')
    .replace(new RegExp(`(?<=${CJK_CHAR})\\s+(?=${CJK_CHAR})`, 'g'), '')
    .replace(/(?<=[0-9])\s+(?=[0-9])/g, '')
    .replace(new RegExp(`(?<=${CJK_CHAR})\\s+(?=[0-9A-Za-z])`, 'g'), '')
    .replace(new RegExp(`(?<=[0-9A-Za-z])\\s+(?=${CJK_CHAR})`, 'g'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

class WinRtOcrService {
  constructor({ scriptPath, powershellPath, spawnImpl, timeoutMs } = {}) {
    this.scriptPath = scriptPath || path.join(__dirname, 'ocr-winrt.ps1')
    this.powershellPath = powershellPath || 'powershell.exe'
    this.spawnImpl = spawnImpl || spawn
    this.timeoutMs = timeoutMs || BATCH_TIMEOUT_MS
    this.detectPromise = null
  }

  run(args) {
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(this.powershellPath, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath, ...args], { windowsHide: true })
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* 进程可能已退出 */ }
        finish(reject, new Error('OCR 识别超时'))
      }, this.timeoutMs)
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
      child.on('error', (error) => finish(reject, error))
      child.on('close', (code) => {
        if (code === 0) finish(resolve, stdout)
        else finish(reject, new Error(stderr.trim() || `OCR 进程退出 (${code})`))
      })
    })
  }

  async detect() {
    if (process.platform !== 'win32') return { available: false, languages: [], reason: '系统 OCR 仅支持 Windows' }
    if (!fs.existsSync(this.scriptPath)) return { available: false, languages: [], reason: 'OCR 脚本缺失' }
    if (!this.detectPromise) {
      this.detectPromise = this.run(['-ListLanguages']).then((output) => {
        const line = output.split(/\r?\n/).find((entry) => entry.startsWith('LANGS='))
        const languages = line ? line.slice(6).split(',').filter(Boolean) : []
        return languages.length > 0
          ? { available: true, languages }
          : { available: false, languages: [], reason: '本机没有安装任何 OCR 识别语言' }
      }).catch((error) => ({ available: false, languages: [], reason: error.message }))
    }
    return this.detectPromise
  }

  async recognize(imagePaths, { lang = DEFAULT_LANG } = {}) {
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) return new Map()
    const args = []
    if (lang) args.push('-LangTag', lang)
    args.push('-ImagePaths', ...imagePaths)
    const output = await this.run(args)
    const results = new Map()
    let current = null
    let mode = null
    let buffer = []
    for (const line of output.split(/\r?\n/)) {
      if (line.startsWith('###IMAGE ')) {
        current = line.slice(9).trim()
        mode = null
        buffer = []
      } else if (line === '###TEXT') {
        mode = 'text'
      } else if (line.startsWith('###ERROR')) {
        if (current) results.set(current, { ok: false, error: line.slice(9).trim() })
        mode = null
      } else if (line === '###END') {
        if (current && !results.has(current)) results.set(current, { ok: true, text: normalizeOcrText(buffer.join('\n')) })
        current = null
        mode = null
        buffer = []
      } else if (mode === 'text') {
        buffer.push(line)
      }
    }
    return results
  }
}

module.exports = { WinRtOcrService, normalizeOcrText }
