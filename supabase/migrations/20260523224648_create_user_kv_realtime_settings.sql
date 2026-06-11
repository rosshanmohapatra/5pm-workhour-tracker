-- ═══════════════════════════════════════════════════════════
-- Migration: create_user_kv_realtime_settings
-- Purpose:   Enable Supabase Realtime (Postgres Changes) for the
--            work_logs table so cross-device sync streams row
--            changes. REPLICA IDENTITY FULL makes UPDATE/DELETE
--            payloads include the previous row.
--            (user_kv gets the same treatment in its own
--            migration once that table exists.)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.work_logs REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname    = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'work_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.work_logs;
  END IF;
END $$;
