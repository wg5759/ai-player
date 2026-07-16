const TMDB_API = 'https://api.themoviedb.org/3'
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500'

async function searchMovie(name, apiKey) {
  if (!apiKey) return { success: false, error: '未配置 TMDB API key' }
  try {
    const url = `${TMDB_API}/search/movie?query=${encodeURIComponent(name)}&language=zh-CN&api_key=${apiKey}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return { success: false, error: `TMDB API ${resp.status}` }
    const data = await resp.json()
    if (data.results && data.results.length > 0) {
      const m = data.results[0]
      return {
        success: true,
        data: {
          title: m.title,
          poster: m.poster_path ? POSTER_BASE + m.poster_path : null,
          overview: m.overview,
          year: m.release_date ? m.release_date.slice(0, 4) : null
        }
      }
    }
    return { success: false, error: '未找到结果' }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

module.exports = { searchMovie }
