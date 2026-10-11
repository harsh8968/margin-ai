/**
 * Mock sign-in for demos. Accounts live only in this browser and nothing guards the API:
 * it shows the flow, it is not security. Passwords are still kept as SHA-256 hashes.
 */

export interface MockUser {
  name: string
  email: string
}

export type AuthResult = { ok: true; user: MockUser } | { ok: false; error: string }

export interface AuthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface StoredUser extends MockUser {
  passwordHash: string
}

export const DEMO_ACCOUNT = { name: 'Demo Student', email: 'demo@margin.ai', password: 'margin123' } as const
export const MIN_PASSWORD = 6

const USERS_KEY = 'margin.mockUsers'
const SESSION_KEY = 'margin.session'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WRONG = 'Wrong email or password.'

const normalizeEmail = (email: string) => email.trim().toLowerCase()

async function hashPassword(email: string, password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`margin:${email}:${password}`))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function readJson<T>(storage: AuthStorage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback // corrupted or unreadable: behave as if empty
  }
}

/** Browser storage that silently falls back to memory when blocked (private mode, disabled cookies). */
export function fallbackStorage(open: () => AuthStorage = () => window.localStorage): AuthStorage {
  const memory = new Map<string, string>()
  const attempt = <T>(read: (s: AuthStorage) => T, fallback: () => T): T => {
    try {
      return read(open())
    } catch {
      return fallback()
    }
  }
  return {
    getItem: (key) => attempt((s) => s.getItem(key), () => memory.get(key) ?? null),
    setItem: (key, value) => attempt((s) => s.setItem(key, value), () => void memory.set(key, value)),
    removeItem: (key) => attempt((s) => s.removeItem(key), () => void memory.delete(key)),
  }
}

export function createMockAuth(storage: AuthStorage = fallbackStorage()) {
  const users = () => readJson<StoredUser[]>(storage, USERS_KEY, [])
  const startSession = (user: MockUser): AuthResult => {
    storage.setItem(SESSION_KEY, JSON.stringify(user))
    return { ok: true, user }
  }

  return {
    currentUser(): MockUser | null {
      return readJson<MockUser | null>(storage, SESSION_KEY, null)
    },

    async logIn(email: string, password: string): Promise<AuthResult> {
      const key = normalizeEmail(email)
      if (key === DEMO_ACCOUNT.email && password === DEMO_ACCOUNT.password) {
        return startSession({ name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email })
      }
      const found = users().find((u) => u.email === key)
      if (!found || found.passwordHash !== (await hashPassword(key, password))) return { ok: false, error: WRONG }
      return startSession({ name: found.name, email: found.email })
    },

    async signUp(name: string, email: string, password: string): Promise<AuthResult> {
      const cleanName = name.trim().slice(0, 60)
      const key = normalizeEmail(email)
      if (!cleanName) return { ok: false, error: 'Enter your name.' }
      if (!EMAIL.test(key)) return { ok: false, error: 'Enter a valid email address.' }
      if (password.length < MIN_PASSWORD) return { ok: false, error: `Use at least ${MIN_PASSWORD} characters for the password.` }
      const existing = users()
      if (key === DEMO_ACCOUNT.email || existing.some((u) => u.email === key)) {
        return { ok: false, error: 'An account with this email already exists. Log in instead.' }
      }
      const user: StoredUser = { name: cleanName, email: key, passwordHash: await hashPassword(key, password) }
      storage.setItem(USERS_KEY, JSON.stringify([...existing, user]))
      return startSession({ name: user.name, email: user.email })
    },

    logOut(): void {
      storage.removeItem(SESSION_KEY)
    },
  }
}
