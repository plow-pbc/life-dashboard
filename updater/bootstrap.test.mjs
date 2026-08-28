import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it, expect, beforeEach } from 'vitest';

// Runs the real bootstrap.sh against a tmp HOME. Every binary it calls is a
// stub on PATH (curl records its argv and answers the pair; git fakes the
// clone's on-disk effect; npm/loginctl/systemctl/chromium are no-ops); the
// two absolute-path prerequisites come in through the LD_NODE / LD_CHROMIUM
// seams, with the real node answering the version probe and parsing JSON.
const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('./bootstrap.sh', import.meta.url));
const PAIR_RESPONSE = JSON.stringify({
  uid: 'kio_1',
  read_token: 'rt_secret',
  cards_url: 'https://api.plow.co/v1/kiosks/kio_1/cards',
  status_url: 'https://api.plow.co/v1/kiosks/kio_1/status',
});

let home, bin, curlLog, envFile;

const stub = async (name, body) => {
  await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`);
  await chmod(join(bin, name), 0o755);
};

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'ld-bootstrap-'));
  bin = join(home, 'bin');
  curlLog = join(home, 'curl.log');
  envFile = join(home, 'ld-data', '.env');
  await mkdir(bin);
  await stub('curl', `echo "$@" >> "${curlLog}"\nprintf '%s' '${PAIR_RESPONSE}'`);
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

const bootstrap = (...args) =>
  run('sh', [SCRIPT, ...args], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      USER: 'kiosk',
      LD_NODE: process.execPath,
      LD_CHROMIUM: join(bin, 'chromium'),
    },
  });

const curlCalls = async () => (await readFile(curlLog, 'utf8').catch(() => '')).split('\n').filter(Boolean);

describe('bootstrap.sh', () => {
  it('--pair redeems the code once and writes ~/ld-data/.env (mode 600); a second run is idempotent', async () => {
    await bootstrap('--pair', 'ABC123');
    await bootstrap('--pair', 'ABC123');
    expect(await readFile(envFile, 'utf8')).toBe(
      'ICAL_URL=\n' +
        'KIOSK_REMOTE_URL=https://api.plow.co/v1/kiosks/kio_1/cards\n' +
        'KIOSK_STATUS_URL=https://api.plow.co/v1/kiosks/kio_1/status\n' +
        'DASHBOARD_TOKEN=rt_secret\n',
    );
    expect((await stat(envFile)).mode & 0o077).toBe(0);
    const calls = await curlCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('https://api.plow.co/v1/kiosks/pair');
    expect(calls[0]).toContain('"code":"ABC123"');
    // The rest of the install happened: ld-current points at the bootstrap clone.
    expect((await stat(join(home, 'ld-current', 'updater'))).isDirectory()).toBe(true);
  });

  it('honors PLOW_API_BASE', async () => {
    await run('sh', [SCRIPT, '--pair', 'ABC123'], {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, USER: 'kiosk', LD_NODE: process.execPath, LD_CHROMIUM: join(bin, 'chromium'), PLOW_API_BASE: 'http://localhost:8000' },
    });
    expect((await curlCalls())[0]).toContain('http://localhost:8000/v1/kiosks/pair');
  });

  it('without --pair writes the empty ICAL_URL .env and never calls the API (local mode, unchanged)', async () => {
    await bootstrap('https://github.com/you/life-dashboard-home.git');
    expect(await readFile(envFile, 'utf8')).toBe('ICAL_URL=\n');
    expect(await curlCalls()).toHaveLength(0);
  });

  it('a used/expired code (410) fails loudly before touching the install', async () => {
    await stub('curl', 'exit 22'); // curl -f on an HTTP error
    await expect(bootstrap('--pair', 'STALE1')).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('pairing failed'),
    });
    await expect(stat(envFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses --pair over a local-mode .env instead of mixing the two', async () => {
    await mkdir(join(home, 'ld-data'), { recursive: true });
    await writeFile(envFile, 'ICAL_URL=x\nDASHBOARD_TOKEN=localtok\n');
    await expect(bootstrap('--pair', 'ABC123')).rejects.toMatchObject({
      stderr: expect.stringContaining('without KIOSK_REMOTE_URL'),
    });
    expect(await curlCalls()).toHaveLength(0);
  });
});
