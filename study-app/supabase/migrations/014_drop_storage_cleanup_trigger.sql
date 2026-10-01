-- ============================================================
-- Migration 014: Drop the legacy app_secrets + pg_net cleanup trigger
--
-- Migration 007 added a BEFORE DELETE trigger on study_materials that
-- called net.http_delete with the Supabase service role key stored in a
-- plain app_secrets table. That design is retired because:
--   * the service role key lived in a table (defense-in-depth failure),
--   * pg_net is unavailable on the free plan's Database Webhook path,
--   * storage cleanup already happens in the application:
--     DELETE /api/materials/[id] and DELETE /api/account remove the
--     Storage object first, and the auth.users cascade covers the rest.
--
-- Drops the trigger, its function and the secrets table. The pg_net
-- extension itself is left alone (other tooling may use it).
-- Idempotent: every drop uses "if exists".
--
-- Verify afterwards:
--   select * from information_schema.triggers
--   where event_object_table = 'study_materials';
--   -- no trg_cleanup_storage_on_delete row
--   select to_regclass('public.app_secrets');  -- null
-- ============================================================

drop trigger if exists trg_cleanup_storage_on_delete on study_materials;

drop function if exists cleanup_storage_on_delete();

-- Held the service role key for the trigger above.
drop table if exists app_secrets;
