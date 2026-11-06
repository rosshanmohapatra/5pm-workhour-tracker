// What's New: one entry per release, newest first. The single source for:
//  - the What's New modal, shown once after an update (lib/pages/index-app.js),
//  - Settings › About › What's New, which reopens it,
//  - the GitHub release notes and the Microsoft Store "What's new" text:
//      node scripts/release-notes.js 1.2.28
// Write each line the way the release notes read: plain, one line each, and
// bug fixes as "Fixed <problem>". No em dashes.
window.WHATS_NEW = [
  {
    version: '1.2.27',
    improvements: [
      'Raise a dispute about any day and email HR to correct your attendance record.',
      'Report a bug from Settings › About, with your device details included.',
      'Updates download in the background; click Update Ready to restart into the new version.',
      'Now comes with a standalone installer for both 32-bit and 64-bit Windows.',
      'Added What\'s New, where you can see what changed in each update.',
    ],
    fixes: [
      'Fixed a session ending on its own at a random hour after a pause or an update.',
      'Fixed the day not starting automatically at sign-in after an update.',
      'Fixed clicking the update notification doing nothing.',
    ],
  },
];
