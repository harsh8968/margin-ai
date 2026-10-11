import type { Background, CanvasElement } from '../canvas/types'
import type {
  AnswerResult,
  AskResult,
  ChatMessage,
  Difficulty,
  Flashcard,
  Health,
  Insights,
  Page,
  Project,
  QuestionType,
  Quiz,
  Recommendations,
  RefineAction,
  RefineResult,
  RevisionSheet,
  Scope,
  SelectionPayload,
  SummaryFormat,
  SummaryResult,
  Transcript,
  VoiceMode,
  VoiceSession,
} from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface Envelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

const REQUEST_TIMEOUT_MS = 120_000

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    throw new ApiError(
      controller.signal.aborted ? 'The request timed out. Try again.' : 'Cannot reach the server. Is the backend running on port 8000?',
      0,
    )
  } finally {
    window.clearTimeout(timer)
  }
  let envelope: Envelope<T> | null = null
  try {
    envelope = (await response.json()) as Envelope<T>
  } catch {
    throw new ApiError(`Server returned an invalid response (${response.status})`, response.status)
  }
  if (!response.ok || !envelope.success) {
    throw new ApiError(envelope.error ?? `Request failed (${response.status})`, response.status)
  }
  return envelope.data as T
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}

const get = <T>(path: string) => request<T>('GET', path)
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body)
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body)
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body)
const del = <T>(path: string) => request<T>('DELETE', path)

export interface ScopeArgs {
  project_id: string
  page_id: string | null
  scope: Scope
  selection?: SelectionPayload | null
}

export const api = {
  health: () => get<Health>('/health'),

  // projects
  listProjects: () => get<Project[]>('/projects'),
  createProject: (name: string) => post<Project>('/projects', { name }),
  renameProject: (id: string, name: string) => patch<Project>(`/projects/${id}`, { name }),
  deleteProject: (id: string) => del<{ deleted: string }>(`/projects/${id}`),
  getProject: (id: string) => get<{ project: Project; pages: Page[] }>(`/projects/${id}`),
  seedDemo: () => post<Project>('/demo/seed'),

  // pages
  addPage: (projectId: string, body: { title?: string; after_page_id?: string | null; background?: Background; elements?: CanvasElement[] }) =>
    post<Page>(`/projects/${projectId}/pages`, body),
  updatePage: (pageId: string, body: { title?: string; background?: Background; elements?: CanvasElement[]; thumbnail?: string }) =>
    patch<{ id: string; content_hash: string; updated_at: string; title: string }>(`/pages/${pageId}`, body),
  deletePage: (pageId: string) => del<{ deleted: string }>(`/pages/${pageId}`),
  restorePage: (pageId: string) => post<Page>(`/pages/${pageId}/restore`),
  duplicatePage: (pageId: string) => post<Page>(`/pages/${pageId}/duplicate`),
  reorderPages: (projectId: string, pageIds: string[]) =>
    put<{ id: string; order: number; number: number }[]>(`/projects/${projectId}/pages/order`, { page_ids: pageIds }),

  uploadAsset: (projectId: string, dataUrl: string) =>
    post<{ id: string; url: string; size: number }>(`/projects/${projectId}/assets`, { data_url: dataUrl }),

  // what the AI sees
  transcripts: (projectId: string) => get<Transcript[]>(`/projects/${projectId}/transcripts`),
  transcribe: (pageId: string, image: string, contentHash: string, force = false) =>
    post<Transcript>(`/pages/${pageId}/transcribe`, { image, content_hash: contentHash, force }),
  correctTranscript: (pageId: string, transcript: string) => put<Transcript>(`/pages/${pageId}/transcript`, { transcript_md: transcript }),

  // AI
  chat: (projectId: string) => get<ChatMessage[]>(`/projects/${projectId}/chat`),
  clearChat: (projectId: string) => del<{ cleared: boolean }>(`/projects/${projectId}/chat`),
  ask: (args: ScopeArgs & { question: string; mode: 'answer' | 'explain'; history: { role: string; content: string; scope: Scope; page_id: string | null }[]; allow_general?: boolean }) =>
    post<AskResult>('/ai/ask', args),
  summarize: (args: ScopeArgs & { format: SummaryFormat }) => post<SummaryResult>('/ai/summarize', args),
  quiz: (args: ScopeArgs & { count: number; types: QuestionType[]; difficulty: Difficulty; focus_topics?: string[] }) =>
    post<Quiz>('/ai/quiz', args),
  answer: (quizId: string, questionIndex: number, userAnswer: string) =>
    post<AnswerResult>(`/ai/quiz/${quizId}/answer`, { question_index: questionIndex, user_answer: userAnswer }),
  refine: (args: { project_id: string; page_id: string; action: RefineAction; scope: 'selection' | 'page'; selection?: SelectionPayload | null; instruction?: string }) =>
    post<RefineResult>('/ai/refine', args),
  generateFlashcards: (args: ScopeArgs & { count: number; focus_topics?: string[] }) =>
    post<{ created: Flashcard[]; unread_pages: number[] }>('/ai/flashcards', args),
  flashcards: (projectId: string) => get<Flashcard[]>(`/projects/${projectId}/flashcards`),
  reviewFlashcard: (cardId: string, result: 'got_it' | 'missed') => post<Flashcard>(`/flashcards/${cardId}/review`, { result }),
  deleteFlashcard: (cardId: string) => del<{ deleted: string }>(`/flashcards/${cardId}`),
  revisionSheet: (projectId: string, pageId: string | null) => post<RevisionSheet>('/ai/revision-sheet', { project_id: projectId, page_id: pageId }),
  insights: (projectId: string) => get<Insights>(`/projects/${projectId}/insights`),
  recommend: (projectId: string, pageId: string | null) => post<Recommendations>('/ai/recommend', { project_id: projectId, page_id: pageId }),

  // voice tutor: a single-use Gemini Live token locked to this notebook
  voiceSession: (body: { project_id: string; page_id: string | null; scope: 'page' | 'project'; mode: VoiceMode }) =>
    post<VoiceSession>('/voice/session', body),
}
