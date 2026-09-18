-- ============================================================
-- Migration 011: Island quizzes + attempts (deterministic island quizzes)
--
-- Island quiz questions are generated once (lazily on first island entry)
-- and stored. Every later visit — including redos — serves the identical
-- set, so scores stay comparable. Attempts keep the full breakdown
-- (quiz + teaching blend) for the per-topic stats.
-- ============================================================

create table if not exists island_quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  island_title text not null,
  -- [{type: 'mcq'|'typed', text, options[4]|null, correctIndex|null,
  --   referenceAnswer|null, concept}]
  questions jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, topic_id, island_title)
);

alter table island_quizzes enable row level security;

drop policy if exists "Users can CRUD their own island quizzes" on island_quizzes;
create policy "Users can CRUD their own island quizzes"
  on island_quizzes for all
  using (auth.uid() = user_id);

create index if not exists idx_island_quizzes_user_id on island_quizzes(user_id);
create index if not exists idx_island_quizzes_topic_id on island_quizzes(topic_id);
create index if not exists idx_island_quizzes_topic_island on island_quizzes(topic_id, island_title);

drop trigger if exists trg_island_quizzes_user_id on island_quizzes;
create trigger trg_island_quizzes_user_id
  before insert on island_quizzes
  for each row
  execute function set_user_id();

create table if not exists island_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  island_title text not null,
  correct_count int not null default 0,
  total int not null default 0,
  teaching_correct int not null default 0,
  teaching_total int not null default 0,
  quiz_pct int not null default 0,
  teaching_pct int not null default 0,
  blended int not null default 0,
  -- [{index, mcqChoice|null, typedText|null, points, maxPoints}]
  answers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table island_quiz_attempts enable row level security;

drop policy if exists "Users can CRUD their own island quiz attempts" on island_quiz_attempts;
create policy "Users can CRUD their own island quiz attempts"
  on island_quiz_attempts for all
  using (auth.uid() = user_id);

create index if not exists idx_island_quiz_attempts_user_id on island_quiz_attempts(user_id);
create index if not exists idx_island_quiz_attempts_topic_id on island_quiz_attempts(topic_id);
create index if not exists idx_island_quiz_attempts_topic_island on island_quiz_attempts(topic_id, island_title);

drop trigger if exists trg_island_quiz_attempts_user_id on island_quiz_attempts;
create trigger trg_island_quiz_attempts_user_id
  before insert on island_quiz_attempts
  for each row
  execute function set_user_id();
