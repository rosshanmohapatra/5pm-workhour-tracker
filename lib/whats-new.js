// What's New: one entry per release, newest first. The single source for:
//  - the What's New modal, shown once after an update (lib/pages/index-app.js),
//  - Settings › About › What's New, which reopens it,
//  - the GitHub release notes and the Microsoft Store "What's new" text:
//      node scripts/release-notes.js 1.2.28
// Write each line the way the release notes read: plain, one line each, and
// bug fixes as "Fixed <problem>". No em dashes.
window.WHATS_NEW = [
  {
    // In progress: more lines are picked from TRACKER.md before tagging.
    version: '1.2.28',
    improvements: [
      "Added What's New, where you can see what changed in each update.",
      "Added a Product Tour. Take it any time from Settings › About.",
    ],
    fixes: [],
  },
  {
    version: '1.2.27',
    improvements: [
      "Added What's New, where you can see what changed in each update.",
    ],
    fixes: [],
  },
];
