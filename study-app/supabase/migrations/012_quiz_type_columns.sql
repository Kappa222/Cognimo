-- ============================================================
-- Migration 012: Typed-question support on the topic-level quiz tables
--
-- The finale big quiz mixes MCQ with free-text questions graded by an AI
-- judge. Attempts also keep the full breakdown (answers + teaching blend)
-- like island attempts do.
-- ============================================================

alter table quiz_questions
  add column if not exists question_type text not null default 'mcq'
    check (question_type in ('mcq', 'typed'));

alter table quiz_questions
  add column if not exists reference_answer text;

alter table quiz_questions
  add column if not exists concept text;

alter table quiz_attempts
  add column if not exists answers jsonb not null default '[]'::jsonb;

alter table quiz_attempts
  add column if not exists teaching_score int;

alter table quiz_attempts
  add column if not exists blended int;
