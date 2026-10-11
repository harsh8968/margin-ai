import { describe, expect, it } from 'vitest'

import { micErrorMessage } from './mic'
import { scheduleStart } from './player'

describe('micErrorMessage', () => {
  it('explains blocked, missing and busy microphones', () => {
    expect(micErrorMessage(new DOMException('no', 'NotAllowedError'))).toMatch(/Microphone blocked/)
    expect(micErrorMessage(new DOMException('no', 'NotFoundError'))).toMatch(/No microphone/)
    expect(micErrorMessage(new DOMException('no', 'NotReadableError'))).toMatch(/busy/)
  })

  it('leaves other errors to the caller', () => {
    expect(micErrorMessage(new Error('boom'))).toBeNull()
    expect(micErrorMessage('nope')).toBeNull()
  })
})

describe('scheduleStart', () => {
  it('queues chunks back to back without gaps', () => {
    expect(scheduleStart(1.0, 1.5)).toBe(1.5)
  })

  it('starts a fresh reply just ahead of now', () => {
    expect(scheduleStart(2.0, 0)).toBeCloseTo(2.02)
  })
})
