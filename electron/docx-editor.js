const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')

// DOCX 无损编辑（第一增量）：在 WordprocessingML 层做查找替换与文末追加，
// 不重排版式。未涉及的段落、样式、图片、表格、页眉页脚保持原样；
// 被替换文字所在段落内的行内样式（加粗/斜体分段）可能合并到首段样式。

const PARAGRAPH_RE = /<w:p\b[\s\S]*?<\/w:p>/g
const TEXT_NODE_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
const FORMAT_WORDS = /^(pdf|word|docx|excel|xlsx|pptx?|txt|markdown|md|文本|表格|演示稿|幻灯片)$/i
const LANGUAGE_WORDS = /^(英文|英语|中文|汉语|日语|日文|韩语|法语|德语|西班牙语|俄语)$/

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function parseEditInstruction(instruction) {
  const text = String(instruction || '').trim()
  if (!text) return null
  const operations = []
  const segments = text.split(/[\n；;]+/).map((segment) => segment.trim()).filter(Boolean)
  for (const rawSegment of segments) {
    const segment = rawSegment.replace(/["'“”‘’«»]/g, '')
    const replace = /^(?:把|将)\s*([^，。]+?)\s*(?:替换成|替换为|换成|改为|改成)(?:为)?\s*([^，。]+?)$/.exec(segment)
    if (replace) {
      const from = replace[1].trim()
      const to = replace[2].trim()
      if (!from || !to) return null
      if (FORMAT_WORDS.test(to) || LANGUAGE_WORDS.test(to)) return null // “改成pdf”是格式转换、“改成英文”是翻译，都不是文字替换
      operations.push({ type: 'replace', from, to })
      continue
    }
    const appendTail = /(?:在|到)?(?:文档|文章)?(?:末尾|文末|最后|结尾)(?:处)?(?:加上|添加|追加|补上)[：:]?\s*(.+)$/.exec(segment)
    const appendHead = /(?:加上|添加|追加|补上)[：:]?\s*(.+?)\s*(?:到|在)(?:文档|文章)?(?:末尾|文末|最后|结尾)(?:处)?$/.exec(segment)
    const append = appendTail || appendHead
    if (append) {
      const lines = String(append[1]).split(/\r?\n|(?<=[。！？；])/).map((line) => line.trim()).filter(Boolean)
      if (lines.length === 0) return null
      operations.push({ type: 'append', lines })
      continue
    }
    return null
  }
  return operations.length > 0 ? operations : null
}

function replaceInParagraph(paragraphXml, from, to) {
  const textNodes = [...paragraphXml.matchAll(TEXT_NODE_RE)]
  if (textNodes.length === 0) return { xml: paragraphXml, count: 0 }
  const combined = textNodes.map((match) => unescapeXml(match[1])).join('')
  if (!combined.includes(from)) return { xml: paragraphXml, count: 0 }
  const count = combined.split(from).length - 1
  const replaced = combined.split(from).join(to)
  // 保留首个文本节点，其余清空：段落属性与首段行内样式保留，其他内容字节不动。
  let used = false
  const xml = paragraphXml.replace(TEXT_NODE_RE, (whole, inner) => {
    if (used) return whole.replace(inner, '')
    used = true
    const spaceAttr = /^\s|\s$/.test(replaced) && !/xml:space="preserve"/.test(whole) ? ' xml:space="preserve"' : ''
    return whole.replace(`<w:t`, `<w:t${spaceAttr}`).replace(inner, escapeXml(replaced))
  })
  return { xml, count }
}

function candidateForms(from) {
  const forms = [from]
  const liTail = /里(?:的)?([^的]+)$/.exec(from)
  if (liTail && liTail[1].length >= 1) forms.push(liTail[1])
  const deTail = /的([^的]+)$/.exec(from)
  if (deTail && deTail[1].length >= 1) forms.push(deTail[1])
  return [...new Set(forms)]
}

function applyReplacements(documentXml, replacements) {
  const items = replacements.map(({ from, to }) => ({ from, to, candidates: candidateForms(from) }))
  const allText = [...documentXml.matchAll(TEXT_NODE_RE)].map((match) => unescapeXml(match[1])).join('')
  const unresolved = []
  for (const item of items) {
    item.use = item.candidates.find((candidate) => allText.includes(candidate))
    if (!item.use) unresolved.push(item.from)
  }
  if (unresolved.length > 0) throw new Error(`没有找到要替换的文字：${unresolved.join('、')}；未改动原文件`)
  let total = 0
  const xml = documentXml.replace(PARAGRAPH_RE, (paragraphXml) => {
    let current = paragraphXml
    for (const item of items) {
      const result = replaceInParagraph(current, item.use, item.to)
      current = result.xml
      total += result.count
    }
    return current
  })
  const finalText = [...xml.matchAll(TEXT_NODE_RE)].map((match) => unescapeXml(match[1])).join('')
  const leftovers = items.filter((item) => finalText.includes(item.use))
  if (total === 0 || leftovers.length > 0) {
    const detail = leftovers.length > 0 ? `（${[...new Set(leftovers.map((item) => item.use))].join('、')} 可能被特殊排版拆分）` : ''
    throw new Error(`未能完整完成替换${detail}；未改动原文件`)
  }
  return { xml, total }
}

function appendParagraphs(documentXml, lines) {
  const paragraphs = lines.map((line) => {
    const heading = /^#{1,3}\s+/.exec(line)
    if (heading) {
      const level = Math.min(heading[0].trim().length, 3)
      return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(line.slice(heading[0].length))}</w:t></w:r></w:p>`
    }
    return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
  }).join('')
  const sectionIndex = documentXml.lastIndexOf('<w:sectPr')
  const insertAt = sectionIndex === -1 ? documentXml.lastIndexOf('</w:body>') : sectionIndex
  if (insertAt === -1) throw new Error('DOCX 结构无效（缺少 w:body）')
  return documentXml.slice(0, insertAt) + paragraphs + documentXml.slice(insertAt)
}

async function editDocx(sourcePath, finalPath, operations) {
  const archive = await JSZip.loadAsync(fs.readFileSync(sourcePath))
  const documentFile = archive.file('word/document.xml')
  if (!documentFile) throw new Error('不是有效的 DOCX（缺少 word/document.xml）')
  let documentXml = await documentFile.async('string')
  const summaries = []
  const replacements = operations.filter((operation) => operation.type === 'replace')
  if (replacements.length > 0) {
    const result = applyReplacements(documentXml, replacements)
    documentXml = result.xml
    summaries.push(`替换 ${result.total} 处文字`)
  }
  for (const operation of operations) {
    if (operation.type !== 'append') continue
    documentXml = appendParagraphs(documentXml, operation.lines)
    summaries.push(`文末追加 ${operation.lines.length} 段`)
  }
  archive.file('word/document.xml', documentXml)
  const buffer = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const tempPath = `${finalPath}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(finalPath), { recursive: true })
  fs.writeFileSync(tempPath, buffer)
  fs.renameSync(tempPath, finalPath)
  return summaries.join('；')
}

module.exports = { editDocx, parseEditInstruction }
