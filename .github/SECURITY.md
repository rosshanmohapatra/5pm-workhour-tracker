# 5pm Security Policy

## Supported Versions

Only the latest release gets security fixes: the web app at
[whtracker.vercel.app](https://whtracker.vercel.app/) (always current) and the newest
Windows version from [Releases](https://github.com/rosshanmohapatra/5pm-workhour-tracker/releases/latest)
or the [Microsoft Store](https://apps.microsoft.com/detail/9ntmgrg95v3m). The Windows app
updates itself, so staying on the latest version is the fix for most reports.

| Version | Supported |
| ------- | --------- |
| 1.2.x (latest) | Yes |
| < 1.2   | No  |

## Reporting a Vulnerability

Please report security issues privately, not in a public issue.

- **Preferred:** [report a vulnerability](https://github.com/rosshanmohapatra/5pm-workhour-tracker/security/advisories/new) through GitHub's private reporting on this repository.
- **Or email** `roshanmohapatra.2001@gmail.com` with the subject "Security Vulnerability: 5pm".

Please include:

- What the issue is and what an attacker could do with it
- Steps to reproduce, or a proof of concept
- The version (web, or the Windows version from Settings › About) and your browser or OS
- Any screenshots, logs or links that help

Reports are usually acknowledged within a week. Once a report is confirmed, a fix is
released before the issue is made public.

Please test only against your own account. Don't access other people's data, run
denial-of-service or load tests, or use automated scanners that flood the service.

## Scope

5pm is a web app with a Windows desktop version. What's in scope:

| Part | What it is |
|---|---|
| Web app | Static HTML, CSS and JavaScript served by Vercel |
| Accounts | Supabase Auth: email and password, Google, passkeys, two-factor authentication (authenticator app) with backup codes |
| Data | Supabase Postgres. Every table has row-level security so an account can only read and write its own rows; two-factor is enforced by the database, not only the sign-in page |
| Sync | Supabase Realtime, limited to the signed-in account's own rows |
| Windows app | Tauri app built from the `desktop` branch; updates are signed and verified before install |

Out of scope: vulnerabilities in Supabase, Vercel, GitHub, Microsoft or Google
themselves (report those to them), and issues that need a device that is already
compromised.

## How 5pm is protected

- **Content Security Policy** with no inline script, checked on every push.
- **Security headers** on every page: HSTS, `X-Frame-Options: DENY`, `nosniff`,
  a strict referrer policy and a locked-down permissions policy.
- **Row-level security** on every table, with a database rule that turns it on for
  any new table automatically.
- **Code scanning** (CodeQL) on every push to `main`.
- **Signed updates** for the Windows app.
- **No secrets in the code.** The public Supabase key is safe to expose: it can do
  nothing that row-level security doesn't allow.
