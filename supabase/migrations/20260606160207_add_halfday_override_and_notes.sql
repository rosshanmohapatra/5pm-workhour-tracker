-- ═══════════════════════════════════════════════════════════
-- Migration: add_halfday_override_and_notes
-- Purpose:   Support Half Day as a day override type, and ensure
--            the per-day notes column exists. Idempotent.
-- ═══════════════════════════════════════════════════════════

-- Widen the override_type CHECK to include 'halfday'
ALTER TABLE public.work_logs DROP CONSTRAINT IF EXISTS work_logs_override_type_check;
ALTER TABLE public.work_logs
  ADD CONSTRAINT work_logs_override_type_check
  CHECK (override_type IN ('leave', 'holiday', 'wfh', 'halfday'));

-- Per-day note (≤ 1000 chars). IF NOT EXISTS so re-runs / fresh DBs are safe.
ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS notes TEXT CHECK (char_length(notes) <= 1000);
