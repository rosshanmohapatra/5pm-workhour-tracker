# 5pm - Work Hour Tracker

> **Leave on time, every time.**

[![Checks](https://github.com/rosshanmohapatra/5pm-workhour-tracker/actions/workflows/csp-check.yml/badge.svg?branch=main)](https://github.com/rosshanmohapatra/5pm-workhour-tracker/actions/workflows/csp-check.yml)
[![Latest release](https://img.shields.io/github/v/release/rosshanmohapatra/5pm-workhour-tracker)](https://github.com/rosshanmohapatra/5pm-workhour-tracker/releases/latest)
[![License](https://img.shields.io/github/license/rosshanmohapatra/5pm-workhour-tracker)](LICENSE)

5pm is a personal work-hour tracker that tells you exactly when to leave each day. It tracks your login time in real time, measures your hours against a daily and weekly target, and shows a live "leave at" time, so you work your hours honestly and not a minute more.

**[Open Web App](https://whtracker.vercel.app/)** · **[Get it from Microsoft Store](https://apps.microsoft.com/detail/9ntmgrg95v3m)** · **[Download for Windows](https://github.com/rosshanmohapatra/5pm-workhour-tracker/releases/latest)**

## Why 5pm?

Most days don't end when the work ends. They end when you finally look at the clock, and by then you've given away another hour nobody asked for. Do that every day and it adds up to burnout.

5pm keeps the count for you. It knows your target, your shift and the days you're off, and tells you the moment you've done enough. Then it's 5pm: go home.

---

## Features

### Tracking
- **Live shift tracking** - start once and the clock runs. Pause and resume any time.
- **Recommended leave time** - a live "Leave at HH:MM", updated every second.
- **Daily and weekly targets** - for example 9 h a day or 45 h a week; a short day is made up across the rest of the week.
- **Auto-stop** - a forgotten session stops itself 2 hours past your daily target (by default). Resume if you're still working.
- **Edit entries** - fix a start or end time afterwards, with overlap checks.

### Planning
- **Plan days** - mark a day as Half Day, Full Day Leave or Holiday.
- **Plan weeks** - schedule early leaves or late stays ahead of time.
- **Leave-by targets** - "I need to leave by 4 PM today", and 5pm plans around it.
- **Penalties** - see which days or weeks fell short and how much is owed.

### Everyday
- **Notifications** - when you hit your target, when overtime starts, and when a deficit builds (while 5pm is open).
- **Raise Dispute** - draft an email to HR when the office attendance system has a day wrong.
- **Reports and backups** - export PDF reports; back up and restore your data as a file.
- **Quick setup** - name, role and routine, and you're done.

### Account and devices
- **Sync across devices** - web, Windows app and phone stay in step.
- **Secure sign-in** - email and password, Google, or a passkey, with two-factor authentication and backup codes.
- **Manage devices** - see every signed-in device, rename them, and sign out the ones you don't use.

---

## Get 5pm

| Platform | Links |
|---|---|
| Website / WebApp | [whtracker.vercel.app](https://whtracker.vercel.app/) |
| Windows 11 | [5pm Setup](https://github.com/rosshanmohapatra/5pm-workhour-tracker/releases/latest) (Standalone) |
| Microsoft Store | [Visit Store](https://apps.microsoft.com/detail/9ntmgrg95v3m) |

Release notes for every version are on the [Releases page](https://github.com/rosshanmohapatra/5pm-workhour-tracker/releases).

---

## Privacy and your data

- Your hours are saved on your device first, so 5pm keeps working offline, then synced to your account.
- Synced data is stored in [Supabase](https://supabase.com/), where row-level security lets each account read and write only its own rows.
- Details are provided in [privacy policy](https://whtracker.vercel.app/privacy.html).

---

## Frequently Asked Questions (FAQ)

| Question | Answer |
|---|---|
| **Can my employer see my hours?** | No. 5pm isn't connected to your employer or any office system. Your hours belong to your account, and only you can see them. |
| **Does it watch what I do on my computer?** | No. 5pm only knows the times you start, pause and stop. It doesn't look at your screen, apps or activity, and it uses no analytics or tracking tools. |
| **Does it work offline?** | Yes. Everything is saved on your device first and syncs when you're back online. |
| **What if I forget to stop the timer?** | Auto-stop ends the session 2 hours past your daily target (by default). If you were still working, press Resume and carry on. You can also fix any start or end time later with Update Entry. |
| **My office attendance system has a day wrong. Can 5pm fix it?** | 5pm can't change your office system, but Raise Dispute drafts an email to HR with that day's real times. |
| **Will I get reminders when 5pm is closed?** | Not yet. Notifications arrive while 5pm is open in a browser tab or running as the Windows app. |
| **How do I delete my account?** | Settings › Security › Delete Account. Your data is kept for 48 hours in case you change your mind, then removed for good. |

---

## Development

5pm is plain HTML, CSS and JavaScript with no build step. The web app is served as-is by Vercel; the Windows app wraps the same files with [Tauri](https://tauri.app/) (on the `desktop` branch).

Uses Node's built-in test runner; nothing to install. The tests also run on every push, together with a check that no inline script slips past the Content Security Policy.

**Configuration**

Copy `.env.example` to `.env.local` and fill it in. The database schema is in `supabase/migrations`.


**Project layout**

```
public/               The website, served as-is by Vercel
├── *.html            The pages
├── icons/            Favicons, logos, social preview
└── lib/              Scripts and styles
    ├── pages/        Each page's script
    └── whats-new.js  Release notes, shown in the app and on GitHub
api/                  Server half of Web Push (not in use yet)
supabase/migrations/  Database tables, security rules and functions
scripts/              Local playground, CSP check, release-note tools
tests/                Automated tests
```

---

## Built with

| | |
|---|---|
| [Supabase](https://supabase.com/) | Sign-in, database, realtime sync |
| [Vercel](https://vercel.com/) | Hosting for the web app |
| [Tauri](https://tauri.app/) | The Windows app |
| [driver.js](https://driverjs.com/) | Product Tour |
| [jsPDF](https://github.com/parallax/jsPDF) + [AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) | PDF reports |
| [QRCode.js](https://github.com/davidshimjs/qrcodejs) | Two-factor setup QR code |
| [Floating UI](https://floating-ui.com/) | Menus and tooltips |
| [NumberFlow](https://number-flow.barvian.me/) | Animated numbers |
| [@use-gesture](https://use-gesture.netlify.app/) | Swipe gestures |

---

## Security

Please report vulnerabilities privately; see [SECURITY.md](.github/SECURITY.md).

## License

[Apache License 2.0](LICENSE) © Roshan Mahapatra. See [NOTICE](NOTICE).
