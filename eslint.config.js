// ESLint: finds likely bugs (not style; Prettier owns layout).
// The app's page scripts are classic <script> files that share globals with each
// other, so "undefined variable" checks are left to the browser and the tests.
// Rules that already had findings when ESLint was added are warnings: new code
// should not add more, old ones get fixed when their file is touched anyway.
const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.claude/**',
      '.workflow/**',
      'playwright-report/**',
      'test-results/**',
      'supabase/templates/**',
      'public/lib/number-flow.js',
      'public/lib/supabase.umd.js',
      'public/lib/driver.js',
      'public/lib/floating-ui.js',
      'public/lib/use-gesture.js',
      'public/lib/sentry.min.js'
    ]
  },
  js.configs.recommended,
  {
    // An empty catch is how this code says "best effort, ignore failure" (storage, clipboard).
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Had findings when ESLint was added: warnings for now (see the note at the top).
      'no-useless-assignment': 'warn',
      'no-self-assign': 'warn',
      'no-unused-vars': 'warn'
    }
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off', 'no-redeclare': 'off' }
  },
  {
    files: ['scripts/**/*.js', 'api/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } }
  },
  {
    files: ['tests/e2e/**/*.js', 'playwright.config.js', 'api/**/*.js', 'public/lib/supabase.js'],
    languageOptions: { sourceType: 'module' }
  },
  prettier
];
