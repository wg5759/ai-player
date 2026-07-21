// 双语字幕服务：SRT 解析、批量翻译对齐、双语合成（原文在上、译文在下）。
// 翻译经 complete 注入（云端模型），批失败保留原文并如实计数，不静默。

function parseSrt(srtText) {
  const entries = []
  const blocks = String(srtText || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.trim().split('\n').filter(Boolean)
    if (lines.length < 2) continue
    const timeLine = lines.find((line) => /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line))
    if (!timeLine) continue
    const timeIndex = lines.indexOf(timeLine)
    const [start, end] = timeLine.split('-->').map((part) => part.trim())
    entries.push({
      index: entries.length + 1,
      start,
      end,
      text: lines.slice(timeIndex + 1).join('\n').trim()
    })
  }
  return entries
}

function formatSrtEntries(entries) {
  return entries.map((entry) => `${entry.index}\n${entry.start} --> ${entry.end}\n${entry.text}`).join('\n\n') + '\n'
}

function buildBilingualSrt(entries, translations) {
  return entries.map((entry) => {
    const translated = translations.get(entry.index)
    const text = translated ? `${entry.text}\n${translated}` : entry.text
    return `${entry.index}\n${entry.start} --> ${entry.end}\n${text}`
  }).join('\n\n') + '\n'
}

function parseTranslationsJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed
  try { parsed = JSON.parse(raw) } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) parsed = JSON.parse(raw.slice(start, end + 1))
    else throw new Error('翻译结果不是有效 JSON')
  }
  const list = Array.isArray(parsed?.translations) ? parsed.translations : []
  const map = new Map()
  for (const item of list) {
    const index = Number(item?.i ?? item?.index)
    const translated = String(item?.text ?? item?.t ?? '').trim()
    if (Number.isInteger(index) && index > 0 && translated) map.set(index, translated)
  }
  return map
}

async function translateEntries(entries, complete, { batchSize = 20, targetLang = '中文', signal } = {}) {
  const translations = new Map()
  let failed = 0
  for (let start = 0; start < entries.length; start += batchSize) {
    const batch = entries.slice(start, start + batchSize)
    const items = batch.map((entry) => ({ i: entry.index, text: entry.text }))
    const prompt = [
      '把下列字幕逐句翻译成' + targetLang + '，保持原意与口语化，不要合并或拆句，不要解释。',
      '只返回一个 JSON 对象，结构 {"translations":[{"i":序号,"text":"译文"}]}，序号必须与输入一致。',
      JSON.stringify({ items })
    ].join('\n')
    try {
      const response = await complete({
        systemPrompt: '你是字幕翻译器，只输出指定结构的 JSON。',
        prompt,
        signal
      })
      const map = parseTranslationsJson(response.text)
      for (const [index, text] of map) {
        if (batch.some((entry) => entry.index === index)) translations.set(index, text)
      }
      failed += batch.filter((entry) => !translations.has(entry.index)).length
    } catch {
      failed += batch.length
    }
  }
  return { translations, failed }
}

module.exports = { parseSrt, formatSrtEntries, buildBilingualSrt, parseTranslationsJson, translateEntries }
