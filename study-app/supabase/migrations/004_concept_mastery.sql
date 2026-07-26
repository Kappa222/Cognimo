-- ============================================================
-- Migration 004: concept_mastery + assessment_rounds tables
-- ============================================================

do $$
begin
  -- =====================
  -- concept_mastery
  -- =====================
  if not exists (select from information_schema.tables where table_name = 'concept_mastery') then
    create table concept_mastery (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references profiles(id) on delete cascade,
      topic_id uuid not null references topics(id) on delete cascade,
      concept text not null,
      status text not null default 'unseen'
        check (status in ('unseen','seen','shaky','solid')),
      correct_count int not null default 0,
      wrong_count int not null default 0,
      last_source text,
      updated_at timestamptz not null default now(),
      unique (user_id, topic_id, concept)
    );

    alter table concept_mastery enable row level security;

    execute 'create policy "Users can CRUD their own concept_mastery"
      on concept_mastery for all
      using (auth.uid() = user_id)';

    create index idx_concept_mastery_user_id on concept_mastery(user_id);
    create index idx_concept_mastery_topic_id on concept_mastery(topic_id);

    drop trigger if exists trg_concept_mastery_user_id on concept_mastery;
    create trigger trg_concept_mastery_user_id
      before insert on concept_mastery
      for each row
      execute function set_user_id();
  end if;

  -- =====================
  -- assessment_rounds
  -- =====================
  if not exists (select from information_schema.tables where table_name = 'assessment_rounds') then
    create table assessment_rounds (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references profiles(id) on delete cascade,
      session_id uuid not null references chat_sessions(id) on delete cascade,
      topic_id uuid not null references topics(id) on delete cascade,
      island_title text not null,
      round int not null,
      is_remediation boolean not null default false,
      question text not null,
      user_answer text not null,
      verdicts jsonb not null,
      created_at timestamptz not null default now()
    );

    alter table assessment_rounds enable row level security;

    execute 'create policy "Users can CRUD their own assessment_rounds"
      on assessment_rounds for all
      using (auth.uid() = user_id)';

    create index idx_assessment_rounds_user_id on assessment_rounds(user_id);
    create index idx_assessment_rounds_session_id on assessment_rounds(session_id);
    create index idx_assessment_rounds_topic_id on assessment_rounds(topic_id);

    drop trigger if exists trg_assessment_rounds_user_id on assessment_rounds;
    create trigger trg_assessment_rounds_user_id
      before insert on assessment_rounds
      for each row
      execute function set_user_id();
  end if;
end $$;
