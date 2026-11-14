-- Backup codes no longer turn two-step off.
--
-- Before: a valid backup code deleted every authenticator and every backup
-- code, because Supabase can't raise a session to aal2 from a backup code.
-- Now: only the code that was used is marked used, two-step stays on, and the
-- session that used it counts as "two-step done" (mfa_satisfied) for as long
-- as that session lives. The session id comes from the signed JWT, so it can't
-- be forged, and the row is removed with the session (sign-out, revoke,
-- expiry) through the foreign key.
--
-- Also: at most 10 wrong backup codes per account in 15 minutes, so the
-- 8-character codes can't be guessed by repeated calls.

create table if not exists public.mfa_backup_sessions (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.mfa_backup_sessions enable row level security;
-- No policies: only the security definer functions below read or write it.

create table if not exists public.mfa_backup_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists mfa_backup_attempts_user_at_idx on public.mfa_backup_attempts (user_id, at);
alter table public.mfa_backup_attempts enable row level security;

create or replace function public.use_backup_code(code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller  uuid := auth.uid();
  sess    uuid := nullif((select auth.jwt()->>'session_id'), '')::uuid;
  code_id uuid;
begin
  if caller is null or sess is null then return false; end if;

  -- Too many wrong codes lately: refuse without checking.
  if (select count(*) from public.mfa_backup_attempts
       where user_id = caller and at > now() - interval '15 minutes') >= 10 then
    raise exception 'Too many attempts. Try again in a few minutes.' using errcode = 'P0001';
  end if;

  select id into code_id from public.mfa_backup_codes
   where user_id = caller
     and used_at is null
     and code_hash = encode(extensions.digest(
           lower(regexp_replace(code, '[^a-zA-Z0-9]', '', 'g')), 'sha256'), 'hex')
   limit 1;

  if code_id is null then
    insert into public.mfa_backup_attempts (user_id) values (caller);
    return false;
  end if;

  update public.mfa_backup_codes set used_at = now() where id = code_id;
  insert into public.mfa_backup_sessions (session_id, user_id) values (sess, caller)
    on conflict (session_id) do nothing;
  delete from public.mfa_backup_attempts where user_id = caller;
  return true;
end;
$$;
revoke execute on function public.use_backup_code(text) from public, anon;
grant execute on function public.use_backup_code(text) to authenticated;

-- Same rules as before, plus: this session passed two-step with a backup code.
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
                     where f.user_id = (select auth.uid()) and f.status = 'verified')
      or exists (select 1 from public.mfa_backup_sessions s
                  where s.session_id = nullif((select auth.jwt()->>'session_id'), '')::uuid
                    and s.user_id = (select auth.uid()));
$$;
revoke execute on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

-- How many unused backup codes the signed-in account has left.
create or replace function public.backup_codes_left()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.mfa_backup_codes
   where user_id = (select auth.uid()) and used_at is null;
$$;
revoke execute on function public.backup_codes_left() from public, anon;
grant execute on function public.backup_codes_left() to authenticated;
