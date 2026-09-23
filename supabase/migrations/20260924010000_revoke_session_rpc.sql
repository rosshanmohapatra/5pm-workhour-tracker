-- ═══════════════════════════════════════════════════════════
-- Migration: revoke_session_rpc
-- Purpose:   Let a signed-in user end ONE of their own sessions,
--            so "Log Out" on a single device in Settings →
--            Manage Devices is real revocation rather than a
--            cooperative flag.
--
-- Why an RPC instead of a serverless function:
--   The JS client cannot revoke a specific session. signOut()
--   only offers local / global / others, and the auth schema is
--   not exposed through PostgREST, so auth.sessions is
--   unreachable from the browser. The usual workaround is an
--   endpoint holding the service_role key. A SECURITY DEFINER
--   function avoids that entirely: no service_role key stored
--   anywhere, no new endpoint, and the caller is still the user.
--
-- Why this is safe:
--   SECURITY DEFINER runs with the definer's rights, so the
--   guardrails matter more than usual:
--     - search_path is pinned to '' and every name is fully
--       qualified, so a caller cannot shadow "sessions" or
--       "uid" with something of their own.
--     - The DELETE is scoped by user_id = auth.uid(), so a user
--       can only ever end their own sessions. Passing someone
--       else's session id deletes nothing and returns false.
--     - EXECUTE is revoked from PUBLIC and anon, then granted
--       only to authenticated.
--
-- Note: deleting the session invalidates its refresh token
-- immediately, but an access token already issued to that device
-- stays valid until it expires (1 hour by default, see
-- Authentication → Sessions). The client also keeps setting its
-- own revoked flag, because deleting a session cannot reach into
-- that device's localStorage to clear the cached hours.
--
-- This migration is idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revoke_session(target_session UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller UUID := auth.uid();
  killed BOOLEAN := FALSE;
BEGIN
  -- Unauthenticated callers get nothing. Belt and braces: EXECUTE is
  -- granted only to authenticated below.
  IF caller IS NULL THEN
    RETURN FALSE;
  END IF;

  -- The user_id predicate is what makes this safe to expose. Without it
  -- any signed-in user could end anyone's session.
  DELETE FROM auth.sessions
   WHERE id = target_session
     AND user_id = caller;

  GET DIAGNOSTICS killed = ROW_COUNT;
  RETURN killed;
END;
$$;

-- Lock down who may call it.
REVOKE ALL     ON FUNCTION public.revoke_session(UUID) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.revoke_session(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revoke_session(UUID) TO authenticated;

COMMENT ON FUNCTION public.revoke_session(UUID) IS
  'Ends one of the calling user''s own auth sessions. Scoped by auth.uid(); returns true if a session was deleted.';
