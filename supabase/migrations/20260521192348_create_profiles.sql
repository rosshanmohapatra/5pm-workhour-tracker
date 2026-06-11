-- ═══════════════════════════════════════════════════════════
-- Migration: create_profiles
-- Purpose:   User profile table extending Supabase auth.users
-- Security:  RLS enabled, column-level grants, SECURITY DEFINER
--            functions isolated in `private` schema (rule 10)
-- ═══════════════════════════════════════════════════════════

-- Private schema for ALL SECURITY DEFINER functions (rule 10)
CREATE SCHEMA IF NOT EXISTS private;

-- Shared updated_at trigger (private schema — rule 10)
CREATE OR REPLACE FUNCTION private.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Profiles table
CREATE TABLE public.profiles (
  id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS immediately (rule 1)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- One policy per operation (rule 7) — all use (SELECT auth.uid()) (rule 2)

-- SELECT: own row only (rule 4 — never USING true)
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

-- INSERT: own row + WITH CHECK (rule 3)
CREATE POLICY "profiles_insert_own"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

-- UPDATE: own row + WITH CHECK (rules 2, 3)
CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING  ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- DELETE: own row only
CREATE POLICY "profiles_delete_own"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = id);

-- Column-level restriction (rule 5):
--   email      → managed by auth.users, not directly writable
--   id         → immutable PK
--   created_at → server-set
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT  UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;

-- updated_at trigger
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- Auto-create profile row on new auth user (SECURITY DEFINER in private — rule 10)
CREATE OR REPLACE FUNCTION private.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();
