-- ═══════════════════════════════════════════════════════════
-- Migration: fix_missing_select_insert_grants
-- Problem:   Migrations 1-3 followed the column-level UPDATE
--            pattern (REVOKE UPDATE → GRANT UPDATE on columns)
--            but never granted SELECT or INSERT at the table level.
--            Result: every pushDay() / pushSettings() call has been
--            silently failing with 42501 — data never left the browser.
--            work_logs, profiles, and user_settings had zero rows in
--            Supabase despite months of local usage.
-- ═══════════════════════════════════════════════════════════

-- work_logs — the primary sync table
GRANT SELECT, INSERT ON public.work_logs TO authenticated;

-- profiles — user display name / avatar
GRANT SELECT, INSERT ON public.profiles TO authenticated;

-- user_settings — settings reads and writes
GRANT SELECT, INSERT ON public.user_settings TO authenticated;

-- Re-apply column-level UPDATE grants (idempotent, confirms correct scope)
-- work_logs: user_id and log_date are immutable identity columns
GRANT UPDATE (
  login_time, logout_time,
  hours_worked, accumulated_secs,
  status, override_type,
  early_leave_target, notes
) ON public.work_logs TO authenticated;

-- profiles: id, email, created_at are immutable
GRANT UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;

-- user_settings: user_id, plan, created_at are immutable
GRANT UPDATE (
  daily_hours, work_days, target_day,
  shift_start, shift_end, timezone,
  auto_stop_buf, notif_enabled
) ON public.user_settings TO authenticated;
