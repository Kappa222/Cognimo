-- ============================================================
-- Migration 013: Delete duplicate chat messages from the double-stream bug
--
-- The learn page retry loop in streamAIResponse ran every AI turn twice
-- (no exit after success), so each Lumi message was generated, saved and
-- rendered a second time. The app now exits after the first success and
-- dedupes on load, but sessions created before the fix still hold the
-- duplicate rows in chat_messages.
--
-- This removes the waste: per session, ordered by (created_at, id), any
-- row whose role + content is byte-identical to its immediate predecessor
-- is deleted (the earliest copy is kept). Non-consecutive repeats and the
-- __ISLANDS__ plan rows are unique vs. their neighbors and are untouched.
-- Idempotent: re-running deletes nothing.
--
-- Dry-run count before applying:
--   select count(*) from (
--     select role, content,
--            lag(role) over w as prev_role,
--            lag(content) over w as prev_content
--     from chat_messages
--     window w as (partition by session_id order by created_at, id)
--   ) s where role = prev_role and content = prev_content;
-- ============================================================

delete from chat_messages a using (
  select id from (
    select id,
           role,
           content,
           lag(role) over w as prev_role,
           lag(content) over w as prev_content
    from chat_messages
    window w as (partition by session_id order by created_at, id)
  ) s
  where role = prev_role
    and content = prev_content
) d
where a.id = d.id;
