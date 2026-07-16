async function searchSubtitle(name, apiKey) {
  if (!apiKey) return { success: false, error: '未配置 OpenSubtitles API key' }
  try {
    const resp = await fetch(
      'https://api.opensubtitles.com/api/v1/subtitles?query=' +
        encodeURIComponent(name) +
        '&languages=zh,en',
      { headers: { 'Api-Key': apiKey, 'User-Agent': 'AIPlayer/1.0' }, signal: AbortSignal.timeout(10000) }
    )
    if (!resp.ok) return { success: false, error: `OpenSubtitles API ${resp.status}` }
    const data = await resp.json()
    if (data.data && data.data.length > 0) {
      return {
        success: true,
        data: data.data.slice(0, 5).map((s) => ({
          id: s.id,
          language: s.attributes.language,
          release: s.attributes.release,
          url: s.attributes.url
        }))
      }
    }
    return { success: false, error: '未找到字幕' }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

module.exports = { searchSubtitle }
