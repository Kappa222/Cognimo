-- ============================================================
-- Migration 006: Add island_step and assess_state to chat_sessions
-- ============================================================

do $$
begin
  if exists (select from information_schema.tables where table_name = 'chat_sessions') then
    if not exists (select from information_schema.columns
      where table_name = 'chat_sessions' and column_name = 'island_step')
    then
      alter table chat_sessions add column island_step text not null default 'teach';
    end if;

    if not exists (select from information_schema.columns
      where table_name = 'chat_sessions' and column_name = 'assess_state')
    then
      alter table chat_sessions add column assess_state jsonb;
    end if;
  end if;
end $$;
