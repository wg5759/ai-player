export function shouldAutoHideControls({ fullscreen, playing }) {
  return Boolean(fullscreen && playing)
}
