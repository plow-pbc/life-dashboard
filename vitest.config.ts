import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Date-boundary assertions (the recipe tile's local-"tonight", formatWhen)
    // are only meaningful against a fixed zone. Pinned here rather than only in
    // the npm script so an IDE runner or a bare `npx vitest` agrees with CI.
    env: { TZ: 'America/Los_Angeles' },
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.test.js',
      'test/**/*.test.ts',
      'api/**/*.test.ts',
      'updater/**/*.test.mjs',
    ],
  },
});
