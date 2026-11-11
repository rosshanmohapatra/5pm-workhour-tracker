/**
 * lib/config.js — single source of truth for Supabase connection details.
 *
 * Loaded as a plain <script> (before the Supabase SDK) on every page so that
 * inline auth-gate scripts and non-module page scripts can read these values
 * without duplicating them. ES-module files (lib/supabase.js) also read from
 * here when running in a browser context.
 *
 * Security note:
 *   Both values are intentionally public — this is the anon (publishable) key.
 *   All data access is enforced by Row-Level Security policies in the database.
 *   The service_role key must NEVER appear in client-side code.
 */
window.__SB_URL      = 'https://ivgathdwiptuymrqzruq.supabase.co';
window.__SB_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z2F0aGR3aXB0dXltcnF6cnVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzODkzMjYsImV4cCI6MjA5NDk2NTMyNn0.cp30eXfoqrESRRzInQLcoierU-Qup4HNAHxPsu21aJ8';
