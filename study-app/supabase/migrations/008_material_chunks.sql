-- ============================================================
-- Migration 008: Add material_chunks table for large-PDF scale-up
--
-- Uploaded materials are split into overlapping text chunks at
-- upload time. AI routes then inject only the chunks relevant to
-- the current island instead of the full corpus, so 400+ page
-- PDFs stay fast and cheap. Chunks cascade-delete with their
-- parent material row.
-- ============================================================

create table if not exists material_chunks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references study_materials(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  idx int not null,
  content text not null,
  created_at timestamptz not null default now(),
  unique (material_id, idx)
);

alter table material_chunks enable row level security;

drop policy if exists "Users can CRUD their own material chunks" on material_chunks;
create policy "Users can CRUD their own material chunks"
  on material_chunks for all
  using (auth.uid() = user_id);

create index if not exists idx_material_chunks_material_id on material_chunks(material_id);
create index if not exists idx_material_chunks_user_id on material_chunks(user_id);

drop trigger if exists trg_material_chunks_user_id on material_chunks;
create trigger trg_material_chunks_user_id
  before insert on material_chunks
  for each row
  execute function set_user_id();
