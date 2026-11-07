// What's New: one entry per release, newest first. The single source for:
//  - the What's New modal, shown once after an update (lib/pages/index-app.js),
//  - Settings › About › What's New, which reopens it,
//  - the GitHub release notes and the Microsoft Store "What's new" text:
//      node scripts/release-notes.js 1.2.28
// Write each line the way the release notes read: plain, one line each, and
// bug fixes as "Fixed <problem>". No em dashes.
window.WHATS_NEW = [
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
