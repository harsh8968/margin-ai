import { useEffect } from 'react'

import { AuthView } from './components/auth/AuthView'
import { EditorView } from './components/editor/EditorView'
import { HomeView } from './components/home/HomeView'
import { ImportProgress } from './components/ui/ImportPicker'
import { Toasts } from './components/ui/Toasts'
import { navigate, useHashRoute } from './lib/hooks'
import { useAiStore } from './store/aiStore'
import { useAuthStore } from './store/authStore'

export default function App() {
  const route = useHashRoute()
  const user = useAuthStore((s) => s.user)
  const loadHealth = useAiStore((s) => s.loadHealth)
  const onAuthScreen = route.name === 'login' || route.name === 'signup'

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  // Signed in on #/login or #/signup: go to the library. A deep link (#/p/…) stays where it is.
  useEffect(() => {
    if (user && onAuthScreen) navigate({ name: 'home' })
  }, [user, onAuthScreen])

  return (
    <>
      {!user ? (
        <AuthView initialMode={route.name === 'signup' ? 'signup' : 'login'} />
      ) : route.name === 'project' ? (
        <EditorView key={route.projectId} projectId={route.projectId} />
      ) : (
        <HomeView />
      )}
      <Toasts />
      <ImportProgress />
    </>
  )
}
