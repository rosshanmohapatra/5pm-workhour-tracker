-- ═══════════════════════════════════════════════════════════
-- Migration: create_deletion_feedback
-- Purpose:   Store the optional feedback people leave when they
--            delete their account. Replaces FormSubmit, which put
--            the developer's email in the page and let anyone send
--            to it.
-- Security:  Signed-in users can only add a row for themselves.
--            Nobody can read, change or delete rows through the API;
--            the developer reads them in the Supabase dashboard.
--            When an account is removed its rows stay, unlinked.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.deletion_feedback (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  reasons    text        CHECK (char_length(reasons) <= 500),
  details    text        CHECK (char_length(details) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deletion_feedback ENABLE ROW LEVEL SECURITY;

-- Insert only, and only as yourself.
DROP POLICY IF EXISTS deletion_feedback_insert_own ON public.deletion_feedback;
CREATE POLICY deletion_feedback_insert_own ON public.deletion_feedback
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Same two-factor rule as every other table.
DROP POLICY IF EXISTS require_2fa ON public.deletion_feedback;
CREATE POLICY require_2fa ON public.deletion_feedback
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied()))
  WITH CHECK ((SELECT public.mfa_satisfied()));

-- Grants: the API can only insert the two text columns.
REVOKE ALL ON public.deletion_feedback FROM anon, authenticated;
GRANT INSERT (reasons, details) ON public.deletion_feedback TO authenticated;
