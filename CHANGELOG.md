# Changelog

All notable changes to 5pm are listed here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Release notes and the in-app What's New are written from this file.

## [Unreleased]

### Added

- Already working? opens a start-time field right in the Today card, with a rolling countdown to when you can leave.
- Toasts stack at the bottom centre; tooltips match the light and dark theme.
- Notifications can be swiped: right to mark read or unread, left to dismiss.
- Import a backup by dropping it into Settings, then merge it with your log or replace it.
- A new Report a Bug form, with the recent errors 5pm noticed added for you.
- Tips point at the exact thing they explain.
- Weekend card: a worked Saturday or Sunday shows as an extra bar and counts in the week.
- Error monitoring with Sentry (errors only, no personal data).

### Changed

- Weekend Today card: greeting on the left, "This week" over the total, no Weekend label.
- Action Center rows show the shortfall and the day type as chips.
- Buttons follow one layout; destructive actions use a red outline.
- Seconds are only kept when you type them.
- The whole codebase is formatted with Prettier; ESLint, Git hooks, browser tests and CI check every change.

### Fixed

- Fixed sheets closing instantly on phones.
- Fixed Update Login Time reading 10:00 at night as morning.
- Fixed very short sessions being saved as 0h 00m.
- Fixed Cancel and Save having different sizes in the Salary Cycle picker.
- Fixed Settings search matching text inside tooltips.

### Security

- Secret scanning (gitleaks) runs before every commit; dependency audit and CI run on every push.

## [1.2.34] - 2026-11-19

### Changed

- Today card: Just today, with a big countdown to when you can leave.
- Quick Start: Start with one tap, or tap Already working? to set an earlier start time.
- Day type in one tap: Switch today to Half Day, Leave or Holiday from the Today card.
- Your Activity: Today sits at the top, and every day opens Update Entry.
- Action Center: Tap a short day to raise a dispute straight away.
- A sharper look: A deeper button colour in light mode and a simpler loading screen.

### Fixed

- Fixed logging out showing that you were signed out from another device.
- Fixed a session starting at a time that hasn't happened yet.
- Fixed Start and Pause responding slowly.
- Fixed the Today card picture jumping when a session starts.
- Fixed fields in Update Entry looking sunken in dark mode.
- Fixed the Penalty Reminders row not switching when tapped.

## [1.2.33] - 2026-11-15

### Changed

- Week in one list: Scroll through every day, weekends too, or jump to any date from the calendar.
- Notification center: Open a notification to read it, and see at a glance what's still unread.
- A 9 to 5 welcome: A small clock runs from 9 to 5 while 5pm opens.
- Simpler Salary Cycle: Pick the start of the month, the 5th, the 7th or any date, right under Shift Hours.
- Contribute: Choose an amount and pay with any UPI app.
- Settings tabs: Tabs in Settings glide between sections.

### Fixed

- Fixed the passkey button showing an oversized icon.
- Fixed the Weekend chart letting go of the day you tapped on phones.
- Fixed the Add hours button fading when you point at a day.
- Fixed View Stats appearing twice on Home.
- Fixed the time picker in Update Entry opening off screen.

## [1.2.32] - 2026-11-15

### Changed

- New sign-in page: Sign in with Google, GitHub or a passkey, and reset your password with a 6-digit code.
- Statistics on Home: See your week or month in bars, with your longest, average and shortest day.
- Action Center: Short days land in one place, ready to email your manager or fix your hours.
- Salary Cycle: Set your pay cycle, and 5pm reminds you to resolve penalties before it closes.
- Today card: See when you started, when you're done and how much is left.
- Weekend view: Your week's total and each day in a chart, with room for a note.
- Saved Logins: See every device you're signed in on, and hold to log out of the others.
- A fresh look: Cooler colours, clearer text and refined cards throughout 5pm.

### Fixed

- Fixed a settings change made just before closing 5pm not being saved.
- Fixed Pause counting your hours twice.
- Fixed 5pm not starting when you began after the auto-stop time.
- Fixed onboarding appearing again on a new device.
- Fixed a backup code turning off two-step verification.
- Fixed the password reset link opening the wrong page.
- Fixed number animations not loading in the Windows app.
- Fixed penalty notifications not matching the Penalty card.

## [1.2.31] - 2026-11-13

### Fixed

- Fixed hours being lost when restarting outside your shift.
- Fixed the Sign-In Methods section in Settings not loading for some accounts.
- Fixed onboarding saving the wrong weekly hours.
- Fixed the End Early modal showing a different target from the Today card.
- Fixed the Appearance section in Settings stacking on phones.

## [1.2.30] - 2026-11-13

### Changed

- A calmer Today card: Switch between Clock and Hours. Once you're done, the bar settles and a banner takes over.
- Done for the day: One clear moment when you hit your hours, with your day and week at a glance.
- Pick the exact minute: A new time wheel for your start, your end and auto-stopped days.
- Set up in seconds: Three quick questions, and you watch your day fill in as you answer.
- Appearance cards: Choose Device Theme, Light or Dark from clear, simple cards.
- Sign-In Methods: See every way you sign in, and switch or disconnect accounts in one place.
- Tidier notifications: Dismiss notifications one by one, on desktop too.

### Fixed

- Fixed the progress bar not moving after you corrected your start time.
- Fixed recommended hours asking for more than a day's work after missed days.
- Fixed your end time sometimes going missing right after you ended your day.
- Fixed Raise Dispute only saving a draft once.
- Fixed input fields being hard to see.
- Fixed the time picker opening in the middle of the screen.
- Fixed Update Entry offering Delete on days with nothing to delete.
- Fixed weekday names in the 30-day Stats view.
- Fixed missing days not counting as 0 hours in the week footer.
- Fixed 5pm using memory and graphics while hidden.

## [1.2.29] - 2026-11-12

### Changed

- A fresh new look, with softer colours and cleaner cards.
- Redesigned your week on Home, so each day reads at a glance.
- See how much time you have in hand this week.
- Sort Stats by any column.
- Faster sync that uses less data.

### Fixed

- Fixed Resume not working after a session was auto-stopped.
- Fixed Update Entry suggesting your shift end instead of when you were last active.
- Fixed password reset links not opening Set New Password.

## [1.2.28] - 2026-11-08

### Changed

- Added What's New, where you can see what changed in each update.
- Added a Product Tour. Take it any time from Settings › About.
- Added tips that show helpful features at the right moment.
- Added a side panel on desktop, with a quick theme switch.
- Notifications now open in a larger window on desktop.
- The sign-in page now shows the method you used last.
- Bug reports now include the details needed to fix the problem faster.
- Copy a bug report in one click.
- 5pm now tells you it's still running when you close its window.
- Refreshed Settings › About.

### Fixed

- Fixed Windows saying 5pm Setup "might not have installed correctly" when 5pm was already installed.
- Fixed Settings tabs leaving a gap at the right edge.

## [1.2.27] - 2026-11-06

### Changed

- Added What's New, where you can see what changed in each update.
