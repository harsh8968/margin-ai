import { create } from 'zustand'

import type { AuthResult, MockUser } from '../lib/mockAuth'
import { createMockAuth } from '../lib/mockAuth'

const auth = createMockAuth()

interface AuthState {
  user: MockUser | null
  logIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (name: string, email: string, password: string) => Promise<AuthResult>
  logOut: () => void
}

/** Who is signed in (mock: see lib/mockAuth). Signing out unmounts the app behind the sign-in screen. */
export const useAuthStore = create<AuthState>((set) => ({
  user: auth.currentUser(),
  logIn: async (email, password) => {
    const result = await auth.logIn(email, password)
    if (result.ok) set({ user: result.user })
    return result
  },
  signUp: async (name, email, password) => {
    const result = await auth.signUp(name, email, password)
    if (result.ok) set({ user: result.user })
    return result
  },
  logOut: () => {
    auth.logOut()
    set({ user: null })
  },
}))
