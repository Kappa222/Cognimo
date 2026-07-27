-- ============================================================
-- Migration 007: Auto-cleanup Storage files on study_materials DELETE
-- Requires: pg_net extension (enable via Supabase Dashboard > SQL Editor)
-- Requires: Insert service role key manually (see bottom of file)
-- ============================================================

-- 1. Create a secrets table to store the Supabase service role key
--    (only accessible within PostgreSQL, not exposed by RLS)
create table if not exists app_secrets (
  key text primary key,
  value text not null
);

alter table app_secrets enable row level security;

-- Only allow the trigger function (security definer) to read secrets
-- Block all user access
create policy "No user access to secrets"
  on app_secrets for all
  using (false);

-- 2. Create the trigger function
create or replace function cleanup_storage_on_delete()
returns trigger
language plpgsql
security definer
as $$
declare
  file_path text;
  base_url text;
  delete_url text;
  service_key text;
begin
  if OLD.file_url is not null then
    -- Extract file path from URL:
    -- URL format: https://{project}.supabase.co/storage/v1/object/public/materials/{path}
    -- Extract: everything after /materials/
    file_path := substring(OLD.file_url from '/materials/(.+)$');

    if file_path is not null then
      -- Get the base URL (e.g. https://xxxx.supabase.co)
      base_url := substring(OLD.file_url from '^(https?://[^/]+)');

      -- Get the service role key from secrets table
      select value into service_key
      from app_secrets
      where key = 'service_role_key';

      if service_key is not null then
        -- Construct admin delete URL (without /public/ in path)
        delete_url := base_url || '/storage/v1/object/materials/' || file_path;

        -- Fire-and-forget async HTTP DELETE
        -- Returns 404 gracefully if file already deleted
        perform net.http_delete(
          url := delete_url,
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || service_key
          )
        );
      end if;
    end if;
  end if;
  return OLD;
end;
$$;

-- 3. Attach the trigger to study_materials
drop trigger if exists trg_cleanup_storage_on_delete on study_materials;
create trigger trg_cleanup_storage_on_delete
  before delete on study_materials
  for each row
  execute function cleanup_storage_on_delete();

-- ============================================================
-- SETUP INSTRUCTIONS
-- ============================================================
-- 1. Enable pg_net extension (run once):
--    create extension if not exists "pg_net";
--
-- 2. Insert your Supabase service_role key:
--    Find it: Supabase Dashboard > Project Settings > API > service_role key
--    insert into app_secrets (key, value)
--    values ('service_role_key', 'eyJhbGciOiJIUzI1NiIs...');
--
-- 3. Verify the trigger is active:
--    select * from information_schema.triggers
--    where event_object_table = 'study_materials';
