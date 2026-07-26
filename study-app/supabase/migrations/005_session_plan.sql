-- ============================================================
-- Migration 005: Add plan jsonb column to chat_sessions
-- ============================================================

do $$
begin
  if exists (select from information_schema.tables where table_name = 'chat_sessions') then
    if not exists (select from information_schema.columns
      where table_name = 'chat_sessions' and column_name = 'plan')
    then
      alter table chat_sessions add column plan jsonb;
    end if;
  end if;
end $$;
