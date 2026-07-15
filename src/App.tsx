import { useState, useEffect } from 'react'
import PlayerView from './components/PlayerView'
import MediaLibrary from './components/MediaLibrary'
import AgentPanel from './components/AgentPanel'
import VoiceWake from './components/VoiceWake'
import { useAgentStore } from './stores/agentStore'
import { usePlayerStore } from './stores/playerStore'
import ErrorBoundary from './components/ErrorBoundary'

// MVP 占位：所有片名映射到示例视频（后续接媒体库扫描真实文件）
const SAMPLE_VIDEO =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'

function AppInner() {
  const [view, setView] = useState<'library' | 'player'>('library')
  const agentOpen = useAgentStore((s) => s.open)
  const isDesktop = window.aiPlayer?.isElectron === true

  useEffect(() => {
    if (!window.aiPlayer?.receiver) return
    const off = window.aiPlayer.receiver.onPlay((url) => {
      usePlayerStore.getState().setMedia(url.split('/').pop() || '投屏', url)
      setView('player')
    })
    return off
  }, [])

  const playMedia = (name: string, path: string) => {
    usePlayerStore.getState().setMedia(name, isDesktop ? path : SAMPLE_VIDEO)
    setView('player')
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-player-bg overflow-hidden">
      {view === 'library' ? (
        <MediaLibrary onPlay={playMedia} />
      ) : (
        <PlayerView onBack={() => setView('library')} />
      )}
      <VoiceWake />
      {agentOpen && <AgentPanel />}
    </div>
  )
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>
}
