-- Two-factor enforced by the database, not just the login page.
--
-- Before this, an account with an authenticator still got a fully working
-- aal1 token after the password step, so the code screen could be skipped by
-- calling the API directly. These restrictive policies sit on top of the
-- ownership policies: an account with a verified authenticator needs aal2
-- (password + code) or a passkey sign-in (amr method 'passkey', which the
-- product treats as two factors). Accounts without an authenticator are
-- unaffected.
do $$
declare t text;
begin
  foreach t in array array['work_logs','user_kv','mfa_backup_codes','profiles','user_settings'] loop
    execute format('drop policy if exists require_2fa on public.%I', t);
    execute format($p$
      create policy require_2fa on public.%I
        as restrictive
        for all
        to authenticated
        using (
          (select auth.jwt()->>'aal') = 'aal2'
          or exists (select 1 from jsonb_array_elements((select auth.jwt())->'amr') m
                     where m->>'method' = 'passkey')
          or not exists (select 1 from auth.mfa_factors f
                         where f.user_id = (select auth.uid()) and f.status = 'verified')
        )
    $p$, t);
  end loop;
end $$;

-- Backup codes are checked here, not in the browser (the policies above stop
-- an aal1 session from reading or marking them). A valid code turns
-- two-factor off and clears the remaining codes, so the user signs in and
-- sets the authenticator up again. Hashing matches login.js
-- (_normalizeBackupCode + SHA-256 hex).
create or replace function public.use_backup_code(code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then return false; end if;
  if not exists (
    select 1 from public.mfa_backup_codes
     where user_id = caller
       and used_at is null
       and code_hash = encode(extensions.digest(
             lower(regexp_replace(code, '[^a-zA-Z0-9]', '', 'g')), 'sha256'), 'hex')
  ) then
    return false;
  end if;
  delete from auth.mfa_factors where user_id = caller;
  delete from public.mfa_backup_codes where user_id = caller;
  return true;
end;
$$;
revoke execute on function public.use_backup_code(text) from public, anon;
grant execute on function public.use_backup_code(text) to authenticated;

-- 20260529193305 granted table-wide UPDATE, which overrides the column lists
-- and let users edit user_settings.plan and profiles.email. Back to columns.
revoke update on public.user_settings from authenticated;
grant update (daily_hours, work_days, target_day, shift_start, shift_end,
              timezone, auto_stop_buf, notif_enabled)
  on public.user_settings to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
