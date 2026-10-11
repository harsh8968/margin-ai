import type { Background, CanvasElement } from '../canvas/types'

export interface Project {
  id: string
  name: string
  created_at: string
  updated_at: string
  page_count: number
  cover_thumbnail: string | null
}

export interface Page {
  id: string
  project_id: string
  title: string
  order: number
  number: number
  width: number
  height: number
  background: Background
  elements: CanvasElement[]
  content_hash: string
  thumbnail: string | null
  updated_at: string
}

export interface Transcript {
  page_id: string
  number: number
  title: string
  has_ink: boolean
  stale: boolean
  transcript_md: string | null
  source: 'vision' | 'typed' | 'seed' | 'user' | null
  user_corrected: boolean
}

export type Scope = 'selection' | 'page' | 'project'
export type Grounding = 'grounded' | 'partial' | 'not_in_notes' | 'general'

export interface Citation {
  page: number
  page_id: string
  quote: string
}

export interface PageRef {
  page: number
  page_id: string
  title: string
}

export interface SelectionPayload {
  image: string | null
  text_blocks: string[]
}

export interface AskResult {
  answer_markdown: string
  citations: Citation[]
  grounding: Grounding
  missing_info: string
  dropped_citations: number
  unread_pages: number[]
  scope: Scope
  mode: 'answer' | 'explain'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  scope: Scope
  page_id: string | null
  citations: Citation[]
  grounding: Grounding | null
  missing_info: string | null
  created_at: string
}

export type SummaryFormat = 'short' | 'detailed' | 'terms'

export interface SummaryResult {
  summary_markdown: string
  pages_used: PageRef[]
  unread_pages: number[]
  scope: Scope
  format: SummaryFormat
}

export type QuestionType = 'mcq' | 'tf' | 'short'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'adaptive'

export interface QuizQuestion {
  index: number
  type: QuestionType
  question: string
  options: string[]
  source_page: number
  source_page_id: string | null
  topic: string
  difficulty: number
}

export interface Quiz {
  quiz_id: string
  difficulty: Exclude<Difficulty, 'adaptive'>
  adaptive_reason: string
  focus_topics: string[]
  questions: QuizQuestion[]
  unread_pages: number[]
}

export interface AnswerResult {
  correct: boolean
  score: number
  verdict: 'correct' | 'partial' | 'incorrect'
  feedback: string
  missing_points: string[]
  correct_answer: string
  explanation: string
  source_page: number
  source_page_id: string | null
}

export type RefineAction = 'simplify' | 'grammar' | 'structure' | 'improve' | 'exam'

export interface RefineResult {
  action: RefineAction
  scope: 'selection' | 'page'
  original_reading: string
  proposed_markdown: string
  change_summary: string
}

export interface Flashcard {
  id: string
  front: string
  back: string
  source_page: number | null
  topic: string
  box: number
  due_at: string
}

export interface RevisionSheet {
  title: string
  sheet_markdown: string
  unread_pages: number[]
}

export interface TopicStat {
  topic: string
  attempts: number
  correct: number
  accuracy: number
  source_pages: number[]
}

export interface Insights {
  total_answers: number
  overall_accuracy: number | null
  topics: TopicStat[]
  weak_topics: TopicStat[]
  strong_topics: TopicStat[]
  recent_quizzes: { quiz_id: string; created_at: string; difficulty: string; answered: number; score: number }[]
  flashcards: { total: number; due: number; boxes: Record<string, number> }
}

export interface Recommendations {
  recommendations: { topic: string; why: string; action: string; pages: PageRef[] }[]
  practice_questions: string[]
  has_history: boolean
}

export interface Health {
  status: string
  llm: string
  model: string | null
  ai_configured: boolean
}

export type VoiceMode = 'viva' | 'explain' | 'buddy'

export interface VoiceSession {
  token: string
  model: string
  mode: VoiceMode
  scope: 'page' | 'project'
  unread_pages: number[]
}
