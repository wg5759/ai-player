// 用应用内 Chromium 的 PDF 渲染（PDFium）把扫描 PDF 按页栅格化为 PNG。
// 隐藏 BrowserWindow 由 main.js 注入；页数由调用方（unpdf 元数据）给出。
const MAX_PAGES = 30
const PAGE_WIDTH = 1600
const PAGE_HEIGHT = Math.round((PAGE_WIDTH * 297) / 210)
const RENDER_DELAY_MS = 700

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function rasterizePdfPages({ pdfPath, pageCount, createWindow }) {
  const pages = Math.max(0, Math.min(Number(pageCount) || 0, MAX_PAGES))
  if (!pages) throw new Error('PDF 页数无效，无法栅格化')
  const win = await createWindow({ width: PAGE_WIDTH, height: PAGE_HEIGHT })
  try {
    const fileUrl = `file:///${String(pdfPath).replace(/\\/g, '/')}`
    const images = []
    for (let page = 1; page <= pages; page += 1) {
      await win.loadURL(`${fileUrl}#page=${page}&zoom=page-width`)
      await delay(RENDER_DELAY_MS)
      const image = await win.webContents.capturePage()
      if (!image || image.isEmpty()) throw new Error(`第 ${page} 页栅格化失败（PDF 渲染不可用）`)
      images.push(image.toPNG())
    }
    return images
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

module.exports = { rasterizePdfPages, MAX_PAGES }
