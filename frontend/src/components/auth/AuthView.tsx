import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { DEMO_ACCOUNT, MIN_PASSWORD } from '../../lib/mockAuth'
import { useAuthStore } from '../../store/authStore'
import { Spinner } from '../ui/Toasts'

type Mode = 'login' | 'signup'

const TAB_LABEL: Record<Mode, string> = { login: 'Log in', signup: 'Sign up' }

const NOTES = ['reads your handwriting, scans too', 'answers only from your notes', 'quizzes you out loud in viva mode']

const COPY: Record<Mode, { title: string; lead: string; submit: string; switchText: string; switchAction: string }> = {
  login: { title: 'Welcome back', lead: 'Pick up where your notes left off.', submit: 'Log in', switchText: 'New here?', switchAction: 'Create an account' },
  signup: { title: 'Start a notebook', lead: 'One account for all your subjects.', submit: 'Create account', switchText: 'Already have one?', switchAction: 'Log in' },
}

export function AuthView({ initialMode }: { initialMode: Mode }) {
  const { logIn, signUp } = useAuthStore.getState()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const copy = COPY[mode]

  const switchTo = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const run = async (attempt: () => ReturnType<typeof logIn>) => {
    setBusy(true)
    setError(null)
    const result = await attempt()
    if (!result.ok) {
      setError(result.error)
      setBusy(false)
    } // on success the app replaces this screen
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(() => (mode === 'login' ? logIn(email, password) : signUp(name, email, password)))
  }

  const signInAsDemo = () => {
    switchTo('login')
    setEmail(DEMO_ACCOUNT.email)
    setPassword(DEMO_ACCOUNT.password)
    void run(() => logIn(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password))
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid min-h-full max-w-6xl items-center gap-14 px-6 py-12 lg:grid-cols-[1.15fr_1fr] lg:gap-20 lg:px-8">
        <section className="rise" aria-labelledby="auth-wordmark">
          <div className="eyebrow mb-4 flex items-center gap-3">
            <span className="h-px w-8 bg-pen" /> AI study canvas
          </div>
          <h1 id="auth-wordmark" className="font-display text-[clamp(3.8rem,9vw,7rem)] font-semibold italic leading-[0.9] tracking-tight">
            Margin
            <svg viewBox="0 0 300 24" className="-mt-2 block h-5 w-[min(340px,62%)] text-pen" aria-hidden>
              <path className="draw-in" pathLength={1} d="M4 16 C 70 4, 160 22, 296 8" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-soft">
            A notebook whose AI has <em className="font-display not-italic text-ink">read your notes</em>, and tells you honestly when they don't cover something.
          </p>

          {/* What the AI writes in your margin, in red pen. */}
          <ol className="relative mt-10 hidden max-w-md border-l-2 border-pen/60 py-1 pl-6 sm:block" aria-label="What Margin does">
            {NOTES.map((note, i) => (
              <li
                key={note}
                className="rise py-1.5 font-hand text-xl leading-snug text-pen"
                style={{ animationDelay: `${450 + i * 160}ms`, transform: `rotate(${i % 2 ? 0.6 : -0.8}deg)` }}
              >
                <span className="mr-2 text-pen/60">{['✓', '→', '◎'][i]}</span>
                {note}
              </li>
            ))}
          </ol>
        </section>

        <section className="rise relative mx-auto w-full max-w-[26rem]" style={{ animationDelay: '140ms' }} aria-label={copy.title}>
          <DemoNote onUse={signInAsDemo} disabled={busy} />

          <div className="flex gap-1 pl-4" role="tablist" aria-label="Account">
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={mode === m}
                onClick={() => switchTo(m)}
                className={`relative rounded-t-xl px-4 pb-2 pt-2.5 text-sm font-bold transition ${
                  mode === m ? 'z-10 -mb-px border border-b-0 border-line bg-paper text-ink' : 'bg-desk-deep/70 text-ink-faint hover:text-ink-soft'
                }`}
              >
                {TAB_LABEL[m]}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="relative rounded-2xl rounded-tl-none border border-line bg-paper p-7 shadow-page" noValidate>
            <h2 className="font-display text-3xl font-semibold leading-tight">{copy.title}</h2>
            <p className="mt-1 text-sm text-ink-soft">{copy.lead}</p>
            <span className="mt-4 block h-px bg-pen/50" aria-hidden />

            <div className="mt-5 flex flex-col gap-4">
              {mode === 'signup' && (
                <Field label="Your name" htmlFor="auth-name">
                  <input id="auth-name" className="field" autoComplete="name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
                </Field>
              )}
              <Field label="Email" htmlFor="auth-email">
                <input
                  id="auth-email"
                  className="field"
                  type="email"
                  inputMode="email"
                  autoComplete={mode === 'login' ? 'username' : 'email'}
                  placeholder="you@college.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus={mode === 'login'}
                />
              </Field>
              <Field label="Password" htmlFor="auth-password" hint={mode === 'signup' ? `At least ${MIN_PASSWORD} characters` : undefined}>
                <div className="relative">
                  <input
                    id="auth-password"
                    className="field pr-11"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-faint hover:text-ink"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-lg bg-missing-soft px-3 py-2 text-sm text-missing">
                {error}
              </p>
            )}

            <button className="btn btn-ink mt-6 w-full" disabled={busy}>
              {busy ? <Spinner /> : <ArrowRight size={16} />} {copy.submit}
            </button>

            <p className="mt-4 text-center text-sm text-ink-soft">
              {copy.switchText}{' '}
              <button type="button" className="font-bold text-pen underline decoration-pen/40 underline-offset-4 hover:decoration-pen" onClick={() => switchTo(mode === 'login' ? 'signup' : 'login')}>
                {copy.switchAction}
              </button>
            </p>
          </form>

          <p className="mt-4 text-center text-[0.72rem] text-ink-faint">Mock sign-in for the demo. Accounts stay in this browser.</p>
        </section>
      </div>
    </div>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={htmlFor} className="text-xs font-bold uppercase tracking-wide text-ink-soft">
          {label}
        </label>
        {hint && <span className="text-[0.7rem] text-ink-faint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** The demo credentials on a taped-on sticky note: one tap signs in. */
function DemoNote({ onUse, disabled }: { onUse: () => void; disabled: boolean }) {
  return (
    <aside
      className="group relative mb-6 ml-auto w-56 rotate-[3deg] bg-partial-soft px-4 pb-3 pt-5 shadow-lift transition duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-1 hover:rotate-[1.5deg] lg:absolute lg:-right-24 lg:-top-16 lg:z-20 lg:mb-0"
      aria-label="Demo account"
    >
      <span className="absolute -top-2.5 left-1/2 h-5 w-20 -translate-x-1/2 -rotate-3 bg-paper/70 shadow-[0_1px_2px_rgba(31,42,68,0.15)]" aria-hidden />
      <p className="font-hand text-lg font-bold leading-none text-ink">Demo account</p>
      <dl className="mt-2 font-hand text-[1.05rem] leading-snug text-ink-soft">
        <div className="flex gap-2">
          <dt className="text-ink-faint">id</dt>
          <dd className="select-all text-ink">{DEMO_ACCOUNT.email}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-ink-faint">pass</dt>
          <dd className="select-all text-ink">{DEMO_ACCOUNT.password}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={onUse}
        disabled={disabled}
        className="mt-2 font-hand text-lg font-bold text-pen underline decoration-pen/40 underline-offset-4 hover:decoration-pen disabled:opacity-50"
      >
        Use it →
      </button>
    </aside>
  )
}
