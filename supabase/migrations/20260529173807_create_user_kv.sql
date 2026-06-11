-- ═══════════════════════════════════════════════════════════
-- Migration: create_user_kv
-- Purpose:   Key-value settings store for cross-device sync.
--
-- Root cause of bug:
--   The user_kv table was created without explicit GRANT
--   statements. PostgreSQL's GRANT ALL ON ALL TABLES only
--   applies to tables that exist at grant-time; new tables
--   get no automatic privileges. Result: code 42501
--   (permission denied) on every SELECT / upsert attempt.
--
-- This migration is idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════


-- ── 1. Table ──────────────────────────────────────────────
--   Composite PK (user_id, key) doubles as the unique
--   conflict target for upsert({ onConflict: 'user_id,key' }).
CREATE TABLE IF NOT EXISTS public.user_kv (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        TEXT        NOT NULL CHECK (char_length(key) <= 100),
  value      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);


-- ── 2. Row-Level Security ──────────────────────────────────
ALTER TABLE public.user_kv ENABLE ROW LEVEL SECURITY;

-- DROP first → idempotent re-runs don't error on duplicates
DROP POLICY IF EXISTS "user_kv_select_own" ON public.user_kv;
DROP POLICY IF EXISTS "user_kv_insert_own" ON public.user_kv;
DROP POLICY IF EXISTS "user_kv_update_own" ON public.user_kv;
DROP POLICY IF EXISTS "user_kv_delete_own" ON public.user_kv;

-- SELECT — own rows only
-- Uses (SELECT auth.uid()) — evaluated once per statement, not per row
CREATE POLICY "user_kv_select_own"
  ON public.user_kv
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- INSERT — own rows + WITH CHECK
CREATE POLICY "user_kv_insert_own"
  ON public.user_kv
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- UPDATE — own rows + WITH CHECK (both clauses required)
CREATE POLICY "user_kv_update_own"
  ON public.user_kv
  FOR UPDATE
  TO authenticated
  USING     ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- DELETE — own rows
CREATE POLICY "user_kv_delete_own"
  ON public.user_kv
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);


-- ── 3. Privilege grants ────────────────────────────────────
-- SELECT  → reads (pullSettings)
-- INSERT  → the insert half of upsert
-- The UPDATE grant below covers the conflict-update half.
GRANT SELECT, INSERT ON public.user_kv TO authenticated;

-- Column-level UPDATE only: value + updated_at are user-writable.
-- user_id and key are immutable identity columns — no UPDATE grant on them.
REVOKE UPDATE ON public.user_kv FROM authenticated;
GRANT  UPDATE (value, updated_at) ON public.user_kv TO authenticated;


-- ── 4. Default privileges (prevent recurrence) ─────────────
-- Ensures every NEW table created in the public schema
-- automatically gets SELECT/INSERT/UPDATE/DELETE for
-- authenticated. Applies to tables created from this point on.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;


-- ── 5. updated_at auto-stamp ──────────────────────────────
DROP TRIGGER IF EXISTS user_kv_set_updated_at ON public.user_kv;
CREATE TRIGGER user_kv_set_updated_at
  BEFORE UPDATE ON public.user_kv
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


-- ── 6. Realtime publication ────────────────────────────────
-- Cross-device sync via initRealtimeSync() requires Postgres
-- Changes to stream from this table. Without this, the
-- .on('postgres_changes', ...) subscription silently receives
-- nothing even though permissions are correct.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname    = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'user_kv'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_kv;
  END IF;
END $$;


-- ── 7. Performance index ───────────────────────────────────
CREATE INDEX IF NOT EXISTS user_kv_user_id_idx
  ON public.user_kv (user_id);


-- ── 8. Table-level UPDATE + DELETE grant ───────────────────
-- PostgREST needs table-level UPDATE/DELETE here — the column-level UPDATE
-- grant above is insufficient for the upsert conflict-update + row deletes.
GRANT UPDATE, DELETE ON public.user_kv TO authenticated;


-- ── 9. Replica identity (realtime old-row data) ────────────
-- FULL so postgres_changes payloads include the previous row on UPDATE/DELETE.
ALTER TABLE public.user_kv REPLICA IDENTITY FULL;
