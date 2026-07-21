const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  parseSrt,
  buildBilingualSrt,
  parseTranslationsJson,
  translateEntries
} = require('../electron/subtitle-bilingual-service')
const WHISPER_MANIFEST = require('../electron/whisper-pack-manifest')

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:04,000 --> 00:00:06,000
This is a test
with two lines

`

test('parseSrt 解析序号、时间轴与多行文本，跳过无效块', () => {
  const entries = parseSrt(SAMPLE_SRT + 'garbage block\n\n')
  assert.equal(entries.length, 2)
  assert.deepEqual(entries[0], { index: 1, start: '00:00:01,000', end: '00:00:03,500', text: 'Hello world' })
  assert.equal(entries[1].text, 'This is a test\nwith two lines')
})

test('buildBilingualSrt 原文在上译文在下，缺译保留原文', () => {
  const entries = parseSrt(SAMPLE_SRT)
  const output = buildBilingualSrt(entries, new Map([[1, '你好，世界']]))
  assert.ok(output.includes('Hello world\n你好，世界'))
  const secondBlock = output.split('\n\n')[1]
  assert.equal(secondBlock, '2\n00:00:04,000 --> 00:00:06,000\nThis is a test\nwith two lines\n')
})

test('parseTranslationsJson 兼容围栏、字段别名与垃圾条目', () => {
  const map = parseTranslationsJson('```json\n{"translations":[{"i":1,"text":"你好"},{"index":2,"t":"世界"},{"i":0,"text":"丢弃"},{"i":3,"text":""}]}\n```')
  assert.equal(map.get(1), '你好')
  assert.equal(map.get(2), '世界')
  assert.equal(map.size, 2)
  assert.throws(() => parseTranslationsJson('not json'), /不是有效 JSON/)
})

test('translateEntries 按批对齐序号，批失败如实计数不中断', async () => {
  const entries = Array.from({ length: 25 }, (_, index) => ({
    index: index + 1,
    start: `00:00:${String(index).padStart(2, '0')},000`,
    end: `00:00:${String(index + 1).padStart(2, '0')},000`,
    text: `line ${index + 1}`
  }))
  let calls = 0
  const complete = async ({ prompt }) => {
    calls += 1
    if (calls === 2) throw new Error('第二批失败')
    const items = JSON.parse(prompt.split('\n').pop()).items
    return { text: JSON.stringify({ translations: items.map((item) => ({ i: item.i, text: `译${item.text}` })) }) }
  }
  const { translations, failed } = await translateEntries(entries, complete, { batchSize: 20 })
  assert.equal(calls, 2)
  assert.equal(translations.size, 20)
  assert.equal(failed, 5)
  assert.equal(translations.get(1), '译line 1')
  assert.equal(translations.get(20), '译line 20')
  assert.equal(translations.has(21), false)
})

test('转写组件清单与托管资产哈希锁定', () => {
  const model = WHISPER_MANIFEST.assets.find((asset) => asset.role === 'model')
  const engine = WHISPER_MANIFEST.assets.find((asset) => asset.kind === 'zip')
  assert.equal(model.sha256, 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21')
  assert.equal(model.size, 77691713)
  assert.equal(engine.sha256, 'd824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d')
  assert.ok(engine.files.length > 10)
  assert.ok(WHISPER_MANIFEST.tag, 'whisper-pack-v1')
  for (const asset of WHISPER_MANIFEST.assets) {
    assert.ok(asset.url.startsWith('https://github.com/wg5759/AgentPlay/releases/download/whisper-pack-v1/'), asset.url)
  }
})

test('双语字幕与转写下载的主进程、菜单、渲染层装配', () => {
  const root = path.join(__dirname, '..')
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8')
  const playerView = fs.readFileSync(path.join(root, 'src', 'components', 'PlayerView.tsx'), 'utf8')
  const modelCenter = fs.readFileSync(path.join(root, 'src', 'components', 'ModelCenter.tsx'), 'utf8')
  assert.match(main, /subtitle:bilingual-generate/)
  assert.match(main, /生成双语字幕（离线识别\+云端翻译）/)
  assert.match(main, /transcribe:status/)
  assert.match(main, /transcribe:download/)
  assert.match(main, /transcribe:cancel-download/)
  assert.match(preload, /subtitleBilingual/)
  assert.match(preload, /transcribe: \{/)
  assert.match(playerView, /bilingual-subtitle/)
  assert.match(playerView, /generateBilingual/)
  assert.match(playerView, /双语字幕只支持本地文件/)
  assert.match(modelCenter, /录音转写组件/)
  assert.match(modelCenter, /下载转写组件/)
})
