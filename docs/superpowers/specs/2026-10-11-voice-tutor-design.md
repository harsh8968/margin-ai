# Voice tutor: design

Date: 2026-10-11 · Status: approved in chat, awaiting spec review

## Goal

A conversational voice assistant in the AI sidebar. The student talks to it naturally (and can
interrupt it); it answers out loud, drawn as an animated blob that reacts to who is speaking.
It knows the open notebook, so it examines and teaches from the student's own notes.

Success: open a notebook, pick the **Voice** tab, press Start, and hold a natural, low-lag
spoken conversation in a live demo, with captions the audience can follow.

## Decisions (from the user)

- "Interview" means a **viva on my notes**: an oral exam on the open notebook.
- Approach A: the browser talks to Gemini Live directly with a short-lived token the backend
  mints and locks. The API key never reaches the browser.
- Not now: saving viva results into Insights history; a voice picker.

## Modes

Each mode is a server-side system prompt built on the same notes packet as Ask
(`build_notes_block`), so "this page" vs "whole notebook" behaves exactly as elsewhere.

| Mode | Behaviour |
|---|---|
| **Viva** (default) | Asks one question at a time drawn from the notes, waits, probes vague answers with one follow-up, corrects briefly, moves on. Covers the notes' topics in order of importance. After about 5 questions, or when the student asks to stop, it gives a short spoken verdict and calls `finish_viva`. |
| **Explain** | The student asks about anything. Explains from the notes in plain spoken language with an analogy, then checks understanding with one quick question. When it goes beyond the notes it says so ("your notes don't cover this, but…"). |
| **Study buddy** | Socratic help: hints and guiding questions instead of answers; gives the answer only when asked twice. |

All modes: short spoken turns (2–4 sentences), no markdown or symbols read aloud, page numbers
said as "page 3", same language the student speaks.

`finish_viva` (viva only) parameters:
`{ score: integer 0–10, summary: string, topics: [{ topic: string, verdict: "strong" | "shaky" | "missed" }] }`.
The client shows it as a scorecard and replies `{ ok: true }`.

## Architecture

```
VoiceTab ──Start──▶ ensureRead(scope) ──▶ POST /api/voice/session ──▶ backend
   │                                         builds prompt from load_docs()
   │                                         mints single-use token with locked
   │                                         model + instructions + voice + tools
   │ ◀──────────── { token, model, unread_pages } ◀──────────────┘
   ▼
liveSession (browser, @google/genai) ⇄ wss Gemini Live (gemini-3.8-live)
   ▲ mic: AudioWorklet → 16 kHz PCM16 chunks (~100 ms)
   ▼ speaker: 24 kHz PCM16 → scheduled AudioBufferSources (flushed on interrupt)
   └▶ analysers (mic + speaker levels) → VoiceBlob canvas
```

### Backend

- `app/config.py`: `voice_model` (env `VOICE_MODEL`, default `gemini-3.8-live`) and
  `voice_name` (env `VOICE_NAME`, default `Kore`).
- `app/ai/voice.py`:
  - `build_voice_instruction(mode, project, scoped_docs, scope) -> str`: mode prompt + scope line + notes packet.
  - `live_config(mode, instruction, voice) -> dict`: response modality AUDIO, speech voice,
    input/output audio transcription, sliding-window context compression, session resumption,
    and the `finish_viva` tool in viva mode.
  - `TokenMinter` protocol with `GeminiTokenMinter` (wraps `client.auth_tokens.create`, `uses=1`,
    30 min expiry, 1 min to start, `live_connect_constraints` = model + config). Tests inject a fake.
- `POST /api/voice/session` (rate-limited like other AI routes), body
  `{ project_id, page_id?, scope: "page" | "project", mode: "viva" | "explain" | "buddy" }`.
  Returns `{ token, model, mode, scope, unread_pages }`. 503 with a setup message when no API key
  is configured, mapped Gemini errors otherwise. An empty notebook still starts (Explain/Buddy can
  chat), but Viva on an empty scope returns 400 "Nothing to examine yet".

### Frontend

- `lib/voice/pcm.ts` (pure): float32 → 16 kHz PCM16 (downsampling) → base64; base64 PCM16 → float32.
- `lib/voice/mic.ts`: getUserMedia (echo cancellation, noise suppression) → AudioWorklet that
  posts float32 frames; emits base64 chunks plus an RMS level; mute flag.
- `lib/voice/player.ts`: queues 24 kHz chunks gap-free on one AudioContext, `flush()` on
  interruption, exposes output level via AnalyserNode.
- `lib/voice/liveSession.ts`: connects with the token (`@google/genai`, lazy-loaded), routes
  server messages (audio → player, transcriptions → captions, `interrupted` → flush,
  `toolCall` → scorecard + tool response, `sessionResumptionUpdate` → store handle,
  `goAway` → reconnect with handle), and closes everything on `end()`.
- `store/voiceStore.ts` (zustand): `status` (idle | connecting | listening | thinking | speaking |
  ended | error), mode, captions (last ~20 turns, merging streamed fragments), muted, error,
  scorecard. Levels are read per animation frame from the session, not stored.
- `components/ai/voice/VoiceBlob.tsx`: canvas blob in the app palette (ink body, pen-red rim
  light, paper highlight). Radius per angle = base + layered sine/noise terms whose amplitude and
  speed come from state and live level. Leans toward the pointer; click toggles the mic (or starts
  the session when idle). Static, gently breathing shape under `prefers-reduced-motion`.
- `components/ai/voice/blobShape.ts` (pure): the radius/colour maths, unit-tested.
- `components/ai/voice/VoiceTab.tsx`: blob, status line, mode picker, Start/End + mute, captions,
  scorecard. Mode and scope are locked while a session is live.
- `aiStore`: new tab `'voice'` (icon `AudioLines`), default scope `project`; the scope switch
  disables Selection for this tab. Leaving the tab, the notebook, or closing the panel ends the session.
- Kick-off: right after connecting, the client sends a short text turn ("Start the session.") so
  the tutor greets first and, in viva, asks question 1.

## Error handling

| Case | What the student sees |
|---|---|
| Mic permission denied / no mic | "Microphone blocked. Allow it in the browser's address bar, then Start again." |
| No API key / token mint fails | The backend's setup or rate-limit message. |
| Connection drops | Status "Disconnected" with a Reconnect button (reuses the resumption handle when present). |
| `goAway` (≈10 min rollover) | Silent reconnect with the resumption handle. |
| Unread handwritten pages | Pages are read first (same pipeline as Ask) while the blob shows "Reading your notes…". |

## Testing

- Backend: instruction contains the right mode rules, scope line and notes; viva on an empty scope
  is rejected; config includes the tool only for viva; endpoint returns the minted token via a fake
  minter and never leaks the API key; 503 when not configured.
- Frontend unit: PCM conversion and downsampling round-trips; blob shape stays within bounds for
  every state and level.
- End to end (real Gemini, in the browser): start a session, send a typed turn, confirm audio
  chunks play and both caption streams fill; viva produces a scorecard when asked to finish. Live
  microphone quality is checked by the user.

## Out of scope

Persisting viva results to Insights, voice picker, video/screen sharing, push-to-talk mode.
