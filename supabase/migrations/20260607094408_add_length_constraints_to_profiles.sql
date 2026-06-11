-- ═══════════════════════════════════════════════════════════
-- Migration: add_length_constraints_to_profiles
-- Purpose:   Bound the free-text profile fields so a client can't
--            store oversized display_name / avatar_url values.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_display_name_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_check
  CHECK (char_length(display_name) <= 100);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_url_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_url_check
  CHECK (char_length(avatar_url) <= 500);
