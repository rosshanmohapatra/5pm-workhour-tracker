/**
 * Supabase client — 5pm work hour tracker
 *
 * Security notes:
 *  • Uses the anon (publishable) key only — never the service_role key.
 *  • The anon key is intentionally public; all data access is enforced by
 *    Row-Level Security policies in the database.
 *  • service_role key must NEVER appear in client-side code.
 *
 * Usage:
 *   import { supabase } from '/lib/supabase.js';
 *   const { data, error } = await supabase.from('profiles').select('*').single();
 */

const SUPABASE_URL     = 'https://ivgathdwiptuymrqzruq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z2F0aGR3aXB0dXltcnF6cnVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzODkzMjYsImV4cCI6MjA5NDk2NTMyNn0.cp30eXfoqrESRRzInQLcoierU-Qup4HNAHxPsu21aJ8';

// Load Supabase JS from CDN (no build step required for vanilla JS app)
// Pin to a specific minor version to avoid unexpected breaking changes.
const _supabaseScript = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

/**
 * Lazily initialise the Supabase client.
 * Calling code should `await getSupabase()` before using the client.
 */
let _client = null;
export async function getSupabase() {
  if (_client) return _client;

  // Load the SDK if not already present (handles vanilla HTML without bundler)
  if (!window.supabase) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = _supabaseScript;
      s.onload  = resolve;
      s.onerror = () => reject(new Error('Failed to load Supabase SDK'));
      document.head.appendChild(s);
    });
  }

  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // Store session in localStorage (acceptable for PWA; tokens are JWTs
      // verified server-side by Supabase on every request).
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return _client;
}

// ─── Auth helpers ────────────────────────────────────────────────────────────

/** Returns the currently signed-in user, or null. */
export async function getCurrentUser() {
  const sb = await getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  return user ?? null;
}

/** Sign in with email + password. */
export async function signInWithEmail(email, password) {
  const sb = await getSupabase();
  return sb.auth.signInWithPassword({ email, password });
}

/** Sign up with email + password. */
export async function signUpWithEmail(email, password, displayName) {
  const sb = await getSupabase();
  return sb.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName ?? email.split('@')[0] } },
  });
}

/** Sign out the current user. */
export async function signOut() {
  const sb = await getSupabase();
  return sb.auth.signOut();
}

// ─── Profile helpers ─────────────────────────────────────────────────────────

/** Fetch the profile for the currently authenticated user. */
export async function getProfile() {
  const sb   = await getSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  return sb
    .from('profiles')
    .select('id, email, display_name, avatar_url, created_at')
    .eq('id', user.id)
    .single();
}

/**
 * Update only the columns the user is allowed to change.
 * Column-level grants on the DB block anything else.
 * @param {{ display_name?: string, avatar_url?: string }} updates
 */
export async function updateProfile(updates) {
  const sb   = await getSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const safe = {};
  if (updates.display_name !== undefined) safe.display_name = String(updates.display_name).slice(0, 100);
  if (updates.avatar_url   !== undefined) safe.avatar_url   = String(updates.avatar_url).slice(0, 500);

  return sb.from('profiles').update(safe).eq('id', user.id);
}

// ─── User Settings helpers ───────────────────────────────────────────────────

/** Fetch settings for the current user. */
export async function getUserSettings() {
  const sb   = await getSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  return sb
    .from('user_settings')
    .select('daily_hours, work_days, target_day, shift_start, shift_end, timezone, auto_stop_buf, notif_enabled, plan')
    .eq('user_id', user.id)
    .single();
}

/**
 * Upsert settings for the current user.
 * Only the user-writable columns are forwarded; plan/user_id/created_at
 * are stripped before the request reaches the database.
 */
export async function upsertUserSettings(settings) {
  const sb   = await getSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  // Strip server-managed columns (belt-and-suspenders on top of DB grants)
  const { plan, user_id, created_at, id, ...safe } = settings;

  return sb
    .from('user_settings')
    .upsert({ user_id: user.id, ...safe }, { onConflict: 'user_id' });
}

// ─── Work Log helpers ────────────────────────────────────────────────────────

/**
 * Upsert a work log entry for a specific date.
 * @param {string} logDate  ISO date string, e.g. '2026-05-22'
 * @param {object} data     Fields to write (see work_logs table)
 */
export async function upsertWorkLog(logDate, data) {
  const sb   = await getSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  // Strip immutable / server-managed columns (belt-and-suspenders)
  const { user_id, log_date, created_at, id, ...safe } = data;

  return sb
    .from('work_logs')
    .upsert(
      { user_id: user.id, log_date: logDate, ...safe },
      { onConflict: 'user_id,log_date' }
    );
}

/** Fetch work logs for the current user within a date range. */
export async function getWorkLogs(fromDate, toDate) {
  const sb   = await getSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  return sb
    .from('work_logs')
    .select('*')
    .eq('user_id', user.id)
    .gte('log_date', fromDate)
    .lte('log_date', toDate)
    .order('log_date', { ascending: false });
}

/** Fetch a single work log by date. */
export async function getWorkLogByDate(logDate) {
  const sb   = await getSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  return sb
    .from('work_logs')
    .select('*')
    .eq('user_id', user.id)
    .eq('log_date', logDate)
    .maybeSingle();
}
