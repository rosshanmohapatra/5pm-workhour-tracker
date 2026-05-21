-- ═══════════════════════════════════════════════════════════
-- Migration: rls_safety_net
-- Purpose:   Guarantee RLS is enabled on every public table,
--            even if a future migration forgets to enable it.
--            Re-run this at the end of every release cycle.
--            (Security requirement rule 9)
-- ═══════════════════════════════════════════════════════════

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;
