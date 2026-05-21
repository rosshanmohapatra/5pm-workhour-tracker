-- ═══════════════════════════════════════════════════════════
-- Migration: create_user_settings
-- Purpose:   Per-user app preferences mirroring the localStorage
--            cfg() object in the 5pm tracker
-- ═══════════════════════════════════════════════════════════

CREATE TABLE public.user_settings (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Work schedule
  daily_hours   NUMERIC(4,2) NOT NULL DEFAULT 8
                             CHECK (daily_hours > 0 AND daily_hours <= 24),
  work_days     TEXT         NOT NULL DEFAULT 'mon,tue,wed,thu,fri',
  target_day    INTEGER      NOT NULL DEFAULT 5
                             CHECK (target_day BETWEEN 1 AND 7),
  shift_start   TEXT         NOT NULL DEFAULT '09:00'
                             CHECK (shift_start ~ '^\d{2}:\d{2}$'),
  shift_end     TEXT         NOT NULL DEFAULT '18:00'
                             CHECK (shift_end   ~ '^\d{2}:\d{2}$'),

  -- App behaviour
  timezone      TEXT         NOT NULL DEFAULT 'UTC',
  auto_stop_buf NUMERIC(3,1)          DEFAULT 0.5
                             CHECK (auto_stop_buf >= 0 AND auto_stop_buf <= 4),
  notif_enabled BOOLEAN      NOT NULL DEFAULT true,

  -- Enum-like status field with CHECK (rule 8)
  -- Server-managed via billing webhook — NOT in the user UPDATE grant below
  plan          TEXT         NOT NULL DEFAULT 'free'
                             CHECK (plan IN ('free', 'pro')),

  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Enable RLS (rule 1)
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- SELECT — own row only (rules 2, 4, 7)
CREATE POLICY "user_settings_select_own"
  ON public.user_settings
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- INSERT — own row + WITH CHECK (rules 2, 3, 7)
CREATE POLICY "user_settings_insert_own"
  ON public.user_settings
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- UPDATE — own row + WITH CHECK (rules 2, 3, 5, 7)
CREATE POLICY "user_settings_update_own"
  ON public.user_settings
  FOR UPDATE
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- DELETE — own row (rules 2, 7)
CREATE POLICY "user_settings_delete_own"
  ON public.user_settings
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Column-level grant (rule 5):
--   user_id    → immutable FK, must not change
--   plan       → server-managed (billing webhook sets this), not user-writable
--   created_at → server-set
REVOKE UPDATE ON public.user_settings FROM authenticated;
GRANT  UPDATE (
  daily_hours,
  work_days,
  target_day,
  shift_start,
  shift_end,
  timezone,
  auto_stop_buf,
  notif_enabled
) ON public.user_settings TO authenticated;

-- updated_at trigger (reuses private.set_updated_at from migration 1)
CREATE TRIGGER user_settings_set_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- Auto-create default settings row when a new user registers
CREATE OR REPLACE FUNCTION private.handle_new_user_settings()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_settings_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user_settings();
