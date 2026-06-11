-- ═══════════════════════════════════════════════════════════
-- Migration: fix_table_level_update_grants
-- Problem:   PostgREST requires table-level UPDATE to execute
--            ON CONFLICT DO UPDATE (upsert). Migrations 1-3 did
--            REVOKE UPDATE at the table level, then granted
--            column-level UPDATE — but PostgREST checks table-level
--            first and rejects with 42501.
--            RLS policies already enforce row-ownership, so
--            table-level UPDATE is safe.
-- ═══════════════════════════════════════════════════════════

GRANT UPDATE ON public.work_logs TO authenticated;
GRANT UPDATE ON public.profiles TO authenticated;
GRANT UPDATE ON public.user_settings TO authenticated;
