import { describe, expect, it } from 'vitest'

import type { AuthStorage } from './mockAuth'
import { DEMO_ACCOUNT, createMockAuth, fallbackStorage } from './mockAuth'

function memoryStorage(): AuthStorage & { dump: () => string } {
  const items = new Map<string, string>()
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
    dump: () => [...items.values()].join('\n'),
  }
}

describe('mock auth', () => {
  it('logs in with the demo account and remembers the session', async () => {
    const storage = memoryStorage()
    const result = await createMockAuth(storage).logIn('  Demo@Margin.ai ', DEMO_ACCOUNT.password)
    expect(result).toEqual({ ok: true, user: { name: DEMO_ACCOUNT.name, email: 'demo@margin.ai' } })
    expect(createMockAuth(storage).currentUser()?.email).toBe('demo@margin.ai') // survives a reload
  })

  it('gives one generic message for a wrong email or password', async () => {
    const auth = createMockAuth(memoryStorage())
    const wrongPassword = await auth.logIn(DEMO_ACCOUNT.email, 'nope-nope')
    const unknownEmail = await auth.logIn('nobody@margin.ai', 'whatever')
    expect(wrongPassword).toEqual({ ok: false, error: 'Wrong email or password.' })
    expect(unknownEmail).toEqual(wrongPassword)
    expect(auth.currentUser()).toBeNull()
  })

  it('signs up, signs in straight away, and stores only a password hash', async () => {
    const storage = memoryStorage()
    const auth = createMockAuth(storage)
    expect(await auth.signUp(' Asha ', 'asha@example.com', 'secret99')).toEqual({ ok: true, user: { name: 'Asha', email: 'asha@example.com' } })
    expect(storage.dump()).not.toContain('secret99')
    auth.logOut()
    expect(auth.currentUser()).toBeNull()
    expect((await auth.logIn('ASHA@example.com', 'secret99')).ok).toBe(true)
  })

  it('explains what is wrong with a signup', async () => {
    const auth = createMockAuth(memoryStorage())
    expect(await auth.signUp('', 'a@b.co', 'secret99')).toEqual({ ok: false, error: 'Enter your name.' })
    expect(await auth.signUp('A', 'not-an-email', 'secret99')).toEqual({ ok: false, error: 'Enter a valid email address.' })
    expect(await auth.signUp('A', 'a@b.co', '12345')).toEqual({ ok: false, error: 'Use at least 6 characters for the password.' })
    expect(await auth.signUp('A', DEMO_ACCOUNT.email, 'secret99')).toEqual({ ok: false, error: 'An account with this email already exists. Log in instead.' })
    await auth.signUp('A', 'a@b.co', 'secret99')
    expect((await auth.signUp('B', 'A@B.co', 'other999')).ok).toBe(false)
  })
})

describe('fallbackStorage', () => {
  it('keeps working in memory when browser storage is blocked', () => {
    const blocked: AuthStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    const storage = fallbackStorage(() => blocked)
    storage.setItem('k', 'v')
    expect(storage.getItem('k')).toBe('v')
    storage.removeItem('k')
    expect(storage.getItem('k')).toBeNull()
  })
})
