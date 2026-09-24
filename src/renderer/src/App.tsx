import { lazy, Suspense, useEffect } from 'react'
import { useApp, type View } from './lib/store'
import { Titlebar } from './components/Titlebar'
import { CommandPalette } from './components/CommandPalette'
import { OfficeDock } from './components/OfficeDock'
import { BoardView } from './views/BoardView'
import { WikiView } from './views/WikiView'
import { QuizView } from './views/QuizView'
import { ensure as ensureAudio } from './lib/audio'
import { initPaneBridge } from './lib/pane-bridge'
import { useRenderLeaf } from './lib/render-leaf'
import ReviewHost from './review/ReviewHost'
import OnboardingGate from './components/OnboardingGate'
import CrewModal from './components/CrewModal'
import { ClipPeek } from './components/ClipPeek'
import { UpdateNotice } from './components/UpdateNotice'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SettingsModal } from './components/SettingsModal'

// WorkspaceView is provided by the panes subsystem; lazy so the office stays first-paint-fast.
const WorkspaceView = lazy(() =>
  import('./views/WorkspaceView')
    .then((m) => ({ default: m.WorkspaceView }))
    .catch(() => ({
      default: () => (
        <div className="flex h-full items-center justify-center text-t3 text-[13px]">
          Workspace is warming up…
        </div>
      )
    }))
)

function WorkspaceSlot() {
  const renderLeaf = useRenderLeaf()
  return (
    <ErrorBoundary fallbackTitle="Workspace encountered an error">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <div
              className="h-2 w-2 rounded-full status-pulse"
              style={{ background: 'var(--color-accent)' }}
            />
          </div>
        }
      >
        {/* grid ⇄ orchestration switch lives inside the workspace */}
        <WorkspaceView renderLeaf={renderLeaf} />
      </Suspense>
    </ErrorBoundary>
  )
}

// 'office' has no entry here - it lives permanently inside OfficeDock so the
// 3D scene (and its WebGL context) never unmounts on tab switches.
const VIEWS: Record<Exclude<View, 'office'>, () => React.ReactNode> = {
  board: () => <BoardView />,
  wiki: () => <WikiView />,
  workspace: () => <WorkspaceSlot />,
  quiz: () => <QuizView />
}

export default function App() {
  const view = useApp((s) => s.view)
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const crewOpen = useApp((s) => s.crewOpen)
  const setCrewOpen = useApp((s) => s.setCrewOpen)

  useEffect(() => {
    init()
    initPaneBridge() // /cmd dispatcher for browser-pane control (no-op off-Electron)
    // first gesture unlocks the audio context
    const unlock = () => ensureAudio()
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('keydown', unlock)

    // g+letter chords
    let gAt = 0
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'g') {
        gAt = Date.now()
        return
      }
      if (Date.now() - gAt < 700) {
        const map: Record<string, View> = {
          o: 'office',
          b: 'board',
          t: 'workspace',
          w: 'wiki',
          q: 'quiz'
        }
        if (map[e.key]) {
          useApp.getState().setView(map[e.key])
          gAt = 0
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-2 w-2 rounded-full status-pulse" style={{ background: 'var(--color-accent)' }} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Titlebar />
      <main className="flex-1 min-h-0">
        <ErrorBoundary fallbackTitle="View encountered an error">
          {view !== 'office' && VIEWS[view]?.()}
          <OfficeDock />
        </ErrorBoundary>
      </main>
      <CommandPalette />
      <ReviewHost />
      <CrewModal open={crewOpen} onClose={() => setCrewOpen(false)} />
      <SettingsModal />
      <OnboardingGate />
      <ClipPeek />
      <UpdateNotice />
    </div>
  )
}
