export const PLAYER_CHROME_HIDE_DELAY_MS = 3000

// 静止鼠标抖动唤醒阈值（像素）：光学/高轮询率鼠标在桌面静止时也会发出 ±1~2px 的
// 连续 mousemove；低于该位移不视为用户活动，避免控制栏被反复唤醒、菜单栏跟着显隐。
export const PLAYER_MOUSE_WAKE_THRESHOLD_PX = 4

export function shouldAutoHideControls({ hasMedia = true, playing, blocked = false }) {
  return Boolean(hasMedia && playing && !blocked)
}

// 上次坐标与本次坐标位移是否达到“真实鼠标活动”标准（供单测与 PlayerView 共用）
export function isRealMouseActivity(last, next, threshold = PLAYER_MOUSE_WAKE_THRESHOLD_PX) {
  if (!last || !next) return true
  return Math.abs(next.x - last.x) >= threshold || Math.abs(next.y - last.y) >= threshold
}
