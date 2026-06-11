-- ═══════════════════════════════════════════════════════════
-- Migration: create_mfa_backup_codes
-- Purpose:   One-time backup codes for the authenticator (TOTP) 2FA
--            flow. Codes are stored as client-computed SHA-256
--            hashes (never plaintext) and consumed atomically at
--            login. RLS scopes every row to its owner.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE public.mfa_backup_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mfa_backup_codes_user_hash_idx
  ON public.mfa_backup_codes (user_id, code_hash);

ALTER TABLE public.mfa_backup_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY mfa_backup_codes_select_own ON public.mfa_backup_codes
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY mfa_backup_codes_insert_own ON public.mfa_backup_codes
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY mfa_backup_codes_update_own ON public.mfa_backup_codes
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY mfa_backup_codes_delete_own ON public.mfa_backup_codes
  FOR DELETE USING ((SELECT auth.uid()) = user_id);
