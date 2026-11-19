// What's New: one entry per release, newest first. The single source for:
//  - the What's New modal, shown once after an update (lib/pages/index-app.js),
//  - Settings › About › What's New, which reopens it,
//  - the GitHub release notes and the Microsoft Store "What's new" text:
//      node scripts/release-notes.js 1.2.29
// Write each line the way the release notes read: plain, one line each, and
// bug fixes as "Fixed <problem>". No em dashes.
window.WHATS_NEW = [
  {
    version: '1.2.34',
    improvements: [
      { icon: 'clock',    title: 'Today card',             line: 'Just today, with a big countdown to when you can leave.' },
      { icon: 'sparkle',  title: 'Quick Start',            line: 'Start with one tap, or tap Already working? to set an earlier start time.' },
      { icon: 'home',     title: 'Day type in one tap',    line: 'Switch today to Half Day, Leave or Holiday from the Today card.' },
      { icon: 'calendar', title: 'Your Activity',          line: 'Today sits at the top, and every day opens Update Entry.' },
      { icon: 'bell',     title: 'Action Center',          line: 'Tap a short day to raise a dispute straight away.' },
      { icon: 'palette',  title: 'A sharper look',         line: 'A deeper button colour in light mode and a simpler loading screen.' },
    ],
    fixes: [
      "Fixed logging out showing that you were signed out from another device.",
      "Fixed a session starting at a time that hasn't happened yet.",
      "Fixed Start and Pause responding slowly.",
      "Fixed the Today card picture jumping when a session starts.",
      "Fixed fields in Update Entry looking sunken in dark mode.",
      "Fixed the Penalty Reminders row not switching when tapped.",
    ],
  },
  {
    version: '1.2.33',
    improvements: [
      { icon: 'calendar', title: 'Week in one list',     line: 'Scroll through every day, weekends too, or jump to any date from the calendar.' },
      { icon: 'bell',     title: 'Notification center',  line: "Open a notification to read it, and see at a glance what's still unread." },
      { icon: 'clock',    title: 'A 9 to 5 welcome',     line: 'A small clock runs from 9 to 5 while 5pm opens.' },
      { icon: 'calendar', title: 'Simpler Salary Cycle', line: 'Pick the start of the month, the 5th, the 7th or any date, right under Shift Hours.' },
      { icon: 'sparkle',  title: 'Contribute',           line: 'Choose an amount and pay with any UPI app.' },
      { icon: 'palette',  title: 'Settings tabs',        line: 'Tabs in Settings glide between sections.' },
    ],
    fixes: [
      "Fixed the passkey button showing an oversized icon.",
      "Fixed the Weekend chart letting go of the day you tapped on phones.",
      "Fixed the Add hours button fading when you point at a day.",
      "Fixed View Stats appearing twice on Home.",
      "Fixed the time picker in Update Entry opening off screen.",
    ],
  },
  {
    version: '1.2.32',
    improvements: [
      { icon: 'shield',   title: 'New sign-in page',   line: 'Sign in with Google, GitHub or a passkey, and reset your password with a 6-digit code.' },
      { icon: 'calendar', title: 'Statistics on Home', line: 'See your week or month in bars, with your longest, average and shortest day.' },
      { icon: 'bell',     title: 'Action Center',      line: 'Short days land in one place, ready to email your manager or fix your hours.' },
      { icon: 'calendar', title: 'Salary Cycle',       line: 'Set your pay cycle, and 5pm reminds you to resolve penalties before it closes.' },
      { icon: 'clock',    title: 'Today card',         line: "See when you started, when you're done and how much is left." },
      { icon: 'home',     title: 'Weekend view',       line: "Your week's total and each day in a chart, with room for a note." },
      { icon: 'shield',   title: 'Saved Logins',       line: "See every device you're signed in on, and hold to log out of the others." },
      { icon: 'palette',  title: 'A fresh look',       line: 'Cooler colours, clearer text and refined cards throughout 5pm.' },
    ],
    fixes: [
      "Fixed a settings change made just before closing 5pm not being saved.",
      "Fixed Pause counting your hours twice.",
      "Fixed 5pm not starting when you began after the auto-stop time.",
      "Fixed onboarding appearing again on a new device.",
      "Fixed a backup code turning off two-step verification.",
      "Fixed the password reset link opening the wrong page.",
      "Fixed number animations not loading in the Windows app.",
      "Fixed penalty notifications not matching the Penalty card.",
    ],
  },
  {
    version: '1.2.31',
    improvements: [],
    fixes: [
      "Fixed hours being lost when restarting outside your shift.",
      "Fixed the Sign-In Methods section in Settings not loading for some accounts.",
      "Fixed onboarding saving the wrong weekly hours.",
      "Fixed the End Early modal showing a different target from the Today card.",
      "Fixed the Appearance section in Settings stacking on phones.",
    ],
  },
  {
    version: '1.2.30',
    improvements: [
      { icon: 'clock',    title: 'A calmer Today card',   line: "Switch between Clock and Hours. Once you're done, the bar settles and a banner takes over." },
      { icon: 'sparkle',  title: 'Done for the day',      line: 'One clear moment when you hit your hours, with your day and week at a glance.' },
      { icon: 'calendar', title: 'Pick the exact minute', line: 'A new time wheel for your start, your end and auto-stopped days.' },
      { icon: 'home',     title: 'Set up in seconds',     line: 'Three quick questions, and you watch your day fill in as you answer.' },
      { icon: 'palette',  title: 'Appearance cards',      line: 'Choose Device Theme, Light or Dark from clear, simple cards.' },
      { icon: 'shield',   title: 'Sign-In Methods',       line: 'See every way you sign in, and switch or disconnect accounts in one place.' },
      { icon: 'bell',     title: 'Tidier notifications',  line: 'Dismiss notifications one by one, on desktop too.' },
    ],
    fixes: [
      "Fixed the progress bar not moving after you corrected your start time.",
      "Fixed recommended hours asking for more than a day's work after missed days.",
      "Fixed your end time sometimes going missing right after you ended your day.",
      "Fixed Raise Dispute only saving a draft once.",
      "Fixed input fields being hard to see.",
      "Fixed the time picker opening in the middle of the screen.",
      "Fixed Update Entry offering Delete on days with nothing to delete.",
      "Fixed weekday names in the 30-day Stats view.",
      "Fixed missing days not counting as 0 hours in the week footer.",
      "Fixed 5pm using memory and graphics while hidden.",
    ],
  },
  {
    version: '1.2.29',
    improvements: [
      "A fresh new look, with softer colours and cleaner cards.",
      "Redesigned your week on Home, so each day reads at a glance.",
      "See how much time you have in hand this week.",
      "Sort Stats by any column.",
      "Faster sync that uses less data.",
    ],
    fixes: [
      "Fixed Resume not working after a session was auto-stopped.",
      "Fixed Update Entry suggesting your shift end instead of when you were last active.",
      "Fixed password reset links not opening Set New Password.",
    ],
  },
  {
    version: '1.2.28',
    improvements: [
      "Added What's New, where you can see what changed in each update.",
      "Added a Product Tour. Take it any time from Settings › About.",
      "Added tips that show helpful features at the right moment.",
      "Added a side panel on desktop, with a quick theme switch.",
      "Notifications now open in a larger window on desktop.",
      "The sign-in page now shows the method you used last.",
      "Bug reports now include the details needed to fix the problem faster.",
      "Copy a bug report in one click.",
      "5pm now tells you it's still running when you close its window.",
      "Refreshed Settings › About.",
    ],
    fixes: [
      'Fixed Windows saying 5pm Setup "might not have installed correctly" when 5pm was already installed.',
      "Fixed Settings tabs leaving a gap at the right edge.",
    ],
  },
  {
    version: '1.2.27',
    improvements: [
      "Added What's New, where you can see what changed in each update.",
    ],
    fixes: [],
  },
];
