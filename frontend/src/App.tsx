import { useEffect } from 'react'

import { EditorView } from './components/editor/EditorView'
import { HomeView } from './components/home/HomeView'
import { ImportProgress } from './components/ui/ImportPicker'
import { Toasts } from './components/ui/Toasts'
import { useHashRoute } from './lib/hooks'
import { useAiStore } from './store/aiStore'

export default function App() {
  const route = useHashRoute()
  const loadHealth = useAiStore((s) => s.loadHealth)

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  return (
    <>
      {route.name === 'project' ? <EditorView key={route.projectId} projectId={route.projectId} /> : <HomeView />}
      <Toasts />
      <ImportProgress />
    </>
  )
}
