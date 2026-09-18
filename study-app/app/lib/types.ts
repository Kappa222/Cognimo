export type SessionPhase = "explain" | "complete";

export type SessionSubPhase =
  | "idle"
  | "waiting-response"
  | "ai-responding"
  | "quiz"
  | "complete";

export interface SessionStep {
  phase: SessionPhase;
  checkpoint: number;
}

export interface Topic {
  id: string;
  name: string;
  subject_id: string;
}

export interface Subject {
  id: string;
  name: string;
}

export interface Material {
  id: string;
  title: string;
  file_type: "text" | "pdf";
  content?: string;
  file_url?: string;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  avatar_url: string;
  system_prompt: string;
}

export interface Profile {
  id: string;
  username: string;
  avatar_url: string;
  preferred_character_id: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  subject_id: string;
  topic_id: string;
  character_id: string;
  current_checkpoint: number;
  total_checkpoints: number;
  status: "in_progress" | "completed" | "abandoned";
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface Island {
  title: string;
  approach: "scenario" | "socratic" | "conversational";
  key_concepts: string[];
  probe_questions: string[];
  chunk_indices?: number[];
  chunk_refs?: { material_id: string; idx: number }[];
}

export interface EvaluateVerdict {
  concept: string;
  verdict: "correct" | "partial" | "wrong" | "missing" | "not_required";
}

export interface EvaluateResult {
  verdicts: EvaluateVerdict[];
  feedback_hint: string;
  next_focus: string | null;
}

// Client-side quiz taking (island quizzes + finale). Question payloads carry
// no answers — grading happens server-side in the attempt endpoints.
export interface QuizRunnerQuestion {
  type: "mcq" | "typed";
  text: string;
  options: string[] | null;
  concept: string;
}

export interface QuizSubmittedAnswer {
  index: number;
  mcqChoice: number | null;
  typedText: string | null;
}

export interface QuizAttemptResult {
  index: number;
  type: "mcq" | "typed";
  concept: string;
  points: number;
  maxPoints: number;
  verdict: "correct" | "partial" | "wrong";
  explanation: string | null;
  correctIndex: number | null;
  referenceAnswer: string | null;
  userAnswer: string | null;
}

export interface QuizAttemptBreakdown {
  quiz_pct: number;
  teaching_pct: number;
  blended: number;
  correct_count: number;
  total: number;
  results: QuizAttemptResult[];
}
