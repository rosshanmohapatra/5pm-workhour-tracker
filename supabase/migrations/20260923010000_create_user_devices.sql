-- ═══════════════════════════════════════════════════════════
-- Migration: create_user_devices
-- Purpose:   Backing store for Settings → Manage Devices.
--
--   One row per (user, browser profile). The client generates a
--   stable device_id (localStorage: wh_device_id) and upserts a
--   row on every launch.
--
--   revoked_at is the "pull the plug" switch. Setting it does NOT
--   kill the other device's Supabase refresh token — the client
--   SDK has no API to revoke one specific remote session. What it
--   does is tell that device, over Realtime (or on its next
--   launch), to sign itself out and wipe its local wh_* cache.
--   True server-side revocation only exists for "all other
--   sessions", which the app does via auth.signOut({scope:'others'}).
--
-- Follows the grant/RLS/realtime pattern established by
-- 20260529173807_create_user_kv.sql — see that file for why the
-- explicit GRANTs are required (new tables inherit nothing).
--
-- This migration is idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════


-- ── 1. Table ──────────────────────────────────────────────
--   Composite PK (user_id, device_id) doubles as the upsert
--   conflict target. The same physical browser signed into two
--   accounts is intentionally two rows.
CREATE TABLE IF NOT EXISTS public.user_devices (
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id    TEXT        NOT NULL CHECK (char_length(device_id) BETWEEN 8 AND 64),
  -- User-facing, renameable. Seeded from a friendly name list client-side.
  name         TEXT        NOT NULL DEFAULT 'New Device'
                           CHECK (char_length(name) BETWEEN 1 AND 40),
  -- Platform's view: "Chrome on Windows". Never user-editable, so a
  -- renamed device is still recognisable.
  platform     TEXT        CHECK (char_length(platform) <= 120),
  -- NULL = active. Non-NULL = this device must sign itself out.
  revoked_at   TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);


-- ── 2. Row-Level Security ──────────────────────────────────
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

-- DROP first → idempotent re-runs don't error on duplicates
DROP POLICY IF EXISTS "user_devices_select_own" ON public.user_devices;
DROP POLICY IF EXISTS "user_devices_insert_own" ON public.user_devices;
DROP POLICY IF EXISTS "user_devices_update_own" ON public.user_devices;
DROP POLICY IF EXISTS "user_devices_delete_own" ON public.user_devices;

-- (SELECT auth.uid()) — evaluated once per statement, not per row
CREATE POLICY "user_devices_select_own"
  ON public.user_devices
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "user_devices_insert_own"
  ON public.user_devices
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "user_devices_update_own"
  ON public.user_devices
  FOR UPDATE
  TO authenticated
  USING     ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "user_devices_delete_own"
  ON public.user_devices
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);


-- ── 3. Privilege grants ────────────────────────────────────
-- Table-level UPDATE/DELETE are required: the column-level grant
-- alone is not enough for PostgREST's upsert conflict-update.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_devices TO authenticated;

-- user_id / device_id / created_at are immutable identity columns.
REVOKE UPDATE ON public.user_devices FROM authenticated;
GRANT  UPDATE (name, platform, revoked_at, last_seen_at)
  ON public.user_devices TO authenticated;
-- Re-grant table-level UPDATE on top (PostgREST upsert needs it).
GRANT UPDATE ON public.user_devices TO authenticated;


-- ── 4. Realtime publication ────────────────────────────────
-- A revoked device finds out instantly via postgres_changes.
-- Without this the subscription silently receives nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname    = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'user_devices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_devices;
  END IF;
END $$;

-- FULL so UPDATE/DELETE payloads carry the previous row.
ALTER TABLE public.user_devices REPLICA IDENTITY FULL;


-- ── 5. Performance index ───────────────────────────────────
CREATE INDEX IF NOT EXISTS user_devices_user_id_idx
  ON public.user_devices (user_id);
