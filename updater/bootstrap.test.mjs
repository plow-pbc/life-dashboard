import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it, expect, beforeEach } from 'vitest';

// Runs the real bootstrap.sh against a tmp HOME. Every binary it calls is a
// stub on PATH (git fakes the clone's on-disk effect; npm/loginctl/systemctl/
// chromium are no-ops); the two absolute-path prerequisites come in through
// the LD_NODE / LD_CHROMIUM seams, with the real node answering the version probe.
const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('./bootstrap.sh', import.meta.url));

let home, bin, envFile;

const stub = async (name, body) => {
  await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`);
  await chmod(join(bin, name), 0o755);
};

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'ld-bootstrap-'));
  bin = join(home, 'bin');
  envFile = join(home, 'ld-data', '.env');
  await mkdir(bin);
  await stub(
    'git',
    `case "$1" in
  -C) [ -d "$2/.git" ] ;;
  clone) d=$3; mkdir -p "$d/.git" "$d/updater"
    touch "$d/life-dashboard-viewer.service" "$d/life-kiosk-viewer.service" \\
      "$d/updater/life-dashboard-updater.service" "$d/updater/life-dashboard-updater.timer" ;;
esac`,
  );
  for (const name of ['npm', 'loginctl', 'systemctl', 'chromium']) await stub(name, 'exit 0');
});

const bootstrap = (...args) => {
  const envOverrides = typeof args[args.length - 1] === 'object' ? args.pop() : {};
  return run('sh', [SCRIPT, ...args], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      USER: 'kiosk',
      LD_NODE: process.execPath,
      LD_CHROMIUM: join(bin, 'chromium'),
      ...envOverrides,
    },
  });
};

describe('bootstrap.sh', () => {
  // Two full installs back to back: well past the default 5 s per-test budget.
  it('writes the empty ICAL_URL .env (mode 600) and installs; a second run is idempotent', async () => {
    await bootstrap('https://github.com/you/life-dashboard-home.git');
    await bootstrap('https://github.com/you/life-dashboard-home.git');
    expect(await readFile(envFile, 'utf8')).toBe('ICAL_URL=\n');
    expect((await stat(envFile)).mode & 0o077).toBe(0);
    // The rest of the install happened: ld-current points at the bootstrap clone.
    expect((await stat(join(home, 'ld-current', 'updater'))).isDirectory()).toBe(true);
  }, 30_000);

  it('never clobbers an existing ~/ld-data/.env', async () => {
    await mkdir(join(home, 'ld-data'), { recursive: true });
    await writeFile(envFile, 'ICAL_URL=https://example.invalid/cal.ics\n');
    await bootstrap();
    expect(await readFile(envFile, 'utf8')).toBe('ICAL_URL=https://example.invalid/cal.ics\n');
  });

  it('rejects an unknown option before touching anything', async () => {
    await expect(bootstrap('--nope')).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('unknown option --nope'),
    });
    await expect(stat(envFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails loudly when chromium is missing', async () => {
    await expect(bootstrap({ LD_CHROMIUM: join(bin, 'absent') })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('sudo apt install chromium'),
    });
    await expect(stat(envFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
