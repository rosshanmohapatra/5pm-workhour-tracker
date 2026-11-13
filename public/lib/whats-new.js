// What's New: one entry per release, newest first. The single source for:
//  - the What's New modal, shown once after an update (lib/pages/index-app.js),
//  - Settings › About › What's New, which reopens it,
//  - the GitHub release notes and the Microsoft Store "What's new" text:
//      node scripts/release-notes.js 1.2.29
// Write each line the way the release notes read: plain, one line each, and
// bug fixes as "Fixed <problem>". No em dashes.
window.WHATS_NEW = [
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
