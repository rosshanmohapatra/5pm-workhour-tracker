-- ═══════════════════════════════════════════════════════════
-- Migration: security_hardening
-- Purpose:   Two fixes from the 2026-11-02 security review.
--   1. revoke_session now requires the caller to have passed
--      two-factor (when the account has it). Before, a password
--      alone was enough to sign the owner out of every device.
--   2. user_kv.value is capped at 64 KB, so one account can't
--      grow storage and bandwidth with huge JSON blobs. The
--      largest value in use today is about 2 KB.
-- ═══════════════════════════════════════════════════════════

-- 1. revoke_session: same body as 20260924010000, plus the 2FA gate.
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
  IF caller IS NULL OR NOT public.mfa_satisfied() THEN
    RETURN FALSE;
  END IF;

  DELETE FROM auth.sessions
   WHERE id = target_session
     AND user_id = caller;

  GET DIAGNOSTICS killed = ROW_COUNT;
  RETURN killed;
END;
$$;

REVOKE ALL     ON FUNCTION public.revoke_session(UUID) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.revoke_session(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revoke_session(UUID) TO authenticated;

-- 2. user_kv: cap each value at 64 KB.
ALTER TABLE public.user_kv DROP CONSTRAINT IF EXISTS user_kv_value_size;
ALTER TABLE public.user_kv
  ADD CONSTRAINT user_kv_value_size CHECK (pg_column_size(value) <= 65536);
