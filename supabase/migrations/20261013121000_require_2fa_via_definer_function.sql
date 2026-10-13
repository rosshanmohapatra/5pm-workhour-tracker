-- Fix for 20261013120000: the require_2fa policies read auth.mfa_factors
-- directly, which the authenticated role may not select, so every query from
-- a signed-in user failed with 42501. The check now lives in a SECURITY
-- DEFINER function that can read it; the policies call the function.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.jwt()->>'aal') = 'aal2'
      or exists (select 1 from jsonb_array_elements((select auth.jwt())->'amr') m
                 where m->>'method' = 'passkey')
      or not exists (select 1 from auth.mfa_factors f
                     where f.user_id = (select auth.uid()) and f.status = 'verified');
$$;
revoke execute on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['work_logs','user_kv','mfa_backup_codes','profiles','user_settings'] loop
    execute format('drop policy if exists require_2fa on public.%I', t);
    execute format('create policy require_2fa on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied()))', t);
  end loop;
end $$;
