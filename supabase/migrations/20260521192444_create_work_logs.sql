-- ═══════════════════════════════════════════════════════════
-- Migration: create_work_logs
-- Purpose:   Daily work tracking records — cloud sync of
--            the localStorage dayLog() data in the 5pm tracker
-- ═══════════════════════════════════════════════════════════

CREATE TABLE public.work_logs (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date           DATE         NOT NULL,

  -- Session times
  login_time         TIMESTAMPTZ,
  logout_time        TIMESTAMPTZ,
  hours_worked       NUMERIC(8,4) CHECK (hours_worked >= 0 AND hours_worked <= 24),
  accumulated_secs   INTEGER      NOT NULL DEFAULT 0
                                  CHECK (accumulated_secs >= 0),

  -- Enum-like status column with CHECK constraint (rule 8)
  status             TEXT         NOT NULL DEFAULT 'pending'
                                  CHECK (status IN (
                                    'pending', 'active', 'paused',
                                    'completed', 'auto_stopped'
                                  )),

  -- Enum-like override column with CHECK constraint (rule 8)
  override_type      TEXT         CHECK (override_type IN (
                                    'leave', 'holiday', 'wfh'
                                  )),

  early_leave_target TIMESTAMPTZ,
  notes              TEXT         CHECK (char_length(notes) <= 1000),

  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- One record per user per calendar day
  UNIQUE (user_id, log_date)
);

-- Enable RLS (rule 1)
ALTER TABLE public.work_logs ENABLE ROW LEVEL SECURITY;

-- SELECT — own rows only (rules 2, 4, 7)
CREATE POLICY "work_logs_select_own"
  ON public.work_logs
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- INSERT — own rows + WITH CHECK (rules 2, 3, 7)
CREATE POLICY "work_logs_insert_own"
  ON public.work_logs
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- UPDATE — own rows + WITH CHECK; user_id stays immutable (rules 2, 3, 5, 7)
CREATE POLICY "work_logs_update_own"
  ON public.work_logs
  FOR UPDATE
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- DELETE — own rows (rules 2, 7)
CREATE POLICY "work_logs_delete_own"
  ON public.work_logs
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Column-level grant (rule 5):
--   user_id    → immutable FK
--   log_date   → immutable after insert (identity of the record)
--   created_at → server-set
REVOKE UPDATE ON public.work_logs FROM authenticated;
GRANT  UPDATE (
  login_time,
  logout_time,
  hours_worked,
  accumulated_secs,
  status,
  override_type,
  early_leave_target,
  notes
) ON public.work_logs TO authenticated;

-- updated_at trigger
CREATE TRIGGER work_logs_set_updated_at
  BEFORE UPDATE ON public.work_logs
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- Performance indexes
CREATE INDEX work_logs_user_date_idx ON public.work_logs (user_id, log_date DESC);
CREATE INDEX work_logs_status_idx    ON public.work_logs (user_id, status)
  WHERE status IN ('active', 'paused');
