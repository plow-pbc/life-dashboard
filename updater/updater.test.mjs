import { mkdir, mkdtemp, readFile, readlink, symlink, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { run } from './updater.mjs';

// Every side effect goes through the injected exec/spawn/fetch, so these tests
// exercise the full decision logic — no git, npm, network, or systemd needed.
// The filesystem contract (release dirs, the ld-current symlink, state files)
// is real, against a tmp HOME.

let home, releases, stateDir, current;

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'ld-updater-'));
  releases = join(home, 'ld-releases');
  stateDir = join(releases, 'state');
  current = join(home, 'ld-current');
  await mkdir(join(releases, 'oldsha0'), { recursive: true });
  await symlink(join(releases, 'oldsha0'), current);
});

// Fake exec: records each command line, answers `git rev-parse origin/main`
// with the configured remote SHA, creates the target dir on `git clone`
// (what the real clone would do), and succeeds at everything else.
const makeExec =
  (log, { remoteSha, failing = null } = {}) =>
  async (argv, opts = {}) => {
    const line = argv.join(' ');
    log.push(line);
    if (failing && line.startsWith(failing))
      return { code: 1, stdout: '', stderr: 'boom: step failed' };
    if (line === 'git rev-parse origin/main') return { code: 0, stdout: `${remoteSha}\n` };
    if (line === 'git config --get remote.origin.url')
      return { code: 0, stdout: 'git@github.com:example/household.git\n' };
    if (argv[0] === 'git' && argv[1] === 'clone')
      await mkdir(argv[argv.length - 1], { recursive: true });
    return { code: 0, stdout: '', cwd: opts.cwd };
  };

const fakeSpawn = () => ({ kill: () => {} });
const noSleep = async () => {};

// Fake fetch: probe-port requests, live requests, and the https status PUT
// answered separately so a test can pass the pre-flip probe but fail the
// post-flip re-check, or fail the status report alone. Every call is recorded.
const makeFetch =
  ({ liveSha, liveOk = true, probeOk = true, statusOk = true }, calls = []) =>
  async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://')) return { ok: statusOk, status: statusOk ? 204 : 500 };
    const probe = url.includes(':5199');
    if (probe) return { ok: probeOk, status: probeOk ? 200 : 500, json: async () => ({}) };
    return {
      ok: liveOk,
      status: liveOk ? 200 : 500,
      json: async () => ({ sha: liveSha, deployedAt: 'x' }),
    };
  };

const deps = (log, opts, calls = []) => ({
  home,
  exec: makeExec(log, opts),
  spawn: fakeSpawn,
  fetch: makeFetch(opts.net ?? { liveSha: opts.remoteSha }, calls),
  sleep: noSleep,
  log: () => {},
  env: opts.env ?? {},
});

describe('updater', () => {
  it('no-ops when remote SHA equals current', async () => {
    const log = [];
    const code = await run(deps(log, { remoteSha: 'oldsha0' }));
    expect(code).toBe(0);
    expect(log).toContain('git fetch');
    expect(log).toContain('git rev-parse origin/main');
    expect(log.some((l) => l.startsWith('npm'))).toBe(false);
    expect(await readlink(current)).toBe(join(releases, 'oldsha0'));
    const result = JSON.parse(await readFile(join(stateDir, 'last-result.json'), 'utf8'));
    expect(result).toMatchObject({ action: 'noop', sha: 'oldsha0', ok: true });
  });

  it('skips a pinned bad SHA', async () => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, 'bad-sha'), 'newsha1\n');
    const log = [];
    const code = await run(deps(log, { remoteSha: 'newsha1' }));
    expect(code).toBe(0);
    expect(log.some((l) => l.startsWith('npm'))).toBe(false);
    expect(await readlink(current)).toBe(join(releases, 'oldsha0'));
    const result = JSON.parse(await readFile(join(stateDir, 'last-result.json'), 'utf8'));
    expect(result).toMatchObject({ action: 'skipped-bad-sha', sha: 'newsha1', ok: true });
  });

  it('builds, health-checks, flips, stamps version.json on success', async () => {
    const log = [];
    const code = await run(deps(log, { remoteSha: 'newsha1' }));
    expect(code).toBe(0);
    expect(log).toContain('git fetch');
    expect(log).toContain('git rev-parse origin/main');
    expect(log).toContain('npm ci');
    expect(log).toContain('npm run build');
    expect(log).toContain('npm test');
    expect(log).toContain('systemctl --user restart life-dashboard-viewer');
    expect(await readlink(current)).toBe(join(releases, 'newsha1'));
    const stamp = JSON.parse(await readFile(join(releases, 'newsha1', 'version.json'), 'utf8'));
    expect(stamp.sha).toBe('newsha1');
    expect(typeof stamp.deployedAt).toBe('string');
    const result = JSON.parse(await readFile(join(stateDir, 'last-result.json'), 'utf8'));
    expect(result).toMatchObject({ action: 'deployed', sha: 'newsha1', ok: true });
  });

  // theme.css is the one shared entry nobody has at install time: it appears
  // whenever the household decides to restyle. The link therefore has to be
  // planted unconditionally, or a stylesheet written after this deploy stays
  // unserved until some later, unrelated flip happens to plant one.
  it('links theme.css into the release whether or not the household has one yet', async () => {
    await mkdir(join(home, 'ld-data'), { recursive: true });
    const theme = join(home, 'ld-data', 'theme.css');
    const link = join(releases, 'newsha1', 'theme.css');

    expect(await run(deps([], { remoteSha: 'newsha1' }))).toBe(0);
    expect(await readlink(link)).toBe(theme);
    // Dangling for now — existsSync follows the link — which is the ENOENT the
    // server answers as its "no theme" 404.
    expect(existsSync(link)).toBe(false);

    // The household writes one later; the link already planted resolves, with
    // no second deploy in between.
    await writeFile(theme, ':root{}\n');
    expect(existsSync(link)).toBe(true);
    expect(await readFile(link, 'utf8')).toBe(':root{}\n');
  });

  // Build/test and probe failures share the arrange/act shape: deploy is
  // refused, ld-current never moves, the SHA stays UNPINNED (a transient
  // failure retries on the next tick), and last-result carries the failing
  // step's output for remote diagnosis.
  it.each([
    ['npm test fails', { remoteSha: 'newsha1', failing: 'npm test' }, 'build-failed'],
    [
      'probe health check fails',
      { remoteSha: 'newsha1', net: { liveSha: null, probeOk: false } },
      'probe-failed',
    ],
  ])('refuses without flipping or pinning when %s', async (_name, opts, action) => {
    const log = [];
    const code = await run(deps(log, opts));
    expect(code).toBe(1);
    expect(await readlink(current)).toBe(join(releases, 'oldsha0'));
    expect(existsSync(join(stateDir, 'bad-sha'))).toBe(false);
    expect(log).not.toContain('systemctl --user restart life-dashboard-viewer');
    const result = JSON.parse(await readFile(join(stateDir, 'last-result.json'), 'utf8'));
    expect(result).toMatchObject({ action, sha: 'newsha1', ok: false });
    if (action === 'build-failed') expect(result.detail).toContain('boom: step failed');
  });

  it('rolls back and pins the SHA when post-flip health check fails', async () => {
    const log = [];
    const code = await run(
      deps(log, { remoteSha: 'newsha1', net: { liveSha: 'oldsha0' } }), // live never reports the new SHA
    );
    expect(code).toBe(1);
    // Flipped, failed the re-check, flipped back.
    expect(await readlink(current)).toBe(join(releases, 'oldsha0'));
    expect(await readFile(join(stateDir, 'bad-sha'), 'utf8')).toContain('newsha1');
    // One restart for the flip, one for the rollback.
    const restarts = log.filter((l) => l === 'systemctl --user restart life-dashboard-viewer');
    expect(restarts).toHaveLength(2);
    const result = JSON.parse(await readFile(join(stateDir, 'last-result.json'), 'utf8'));
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ action: 'rolled-back', sha: 'newsha1' });
  });

  it('prunes to the 5 newest releases', async () => {
    // Six stale releases older than oldsha0; the successful deploy adds
    // newsha1, then pruning must keep the 5 newest (state/ is never touched).
    for (let i = 1; i <= 6; i++) {
      const dir = join(releases, `stale${i}`);
      await mkdir(dir);
      const t = new Date(2020, 0, i); // older than everything else, ascending
      await utimes(dir, t, t);
    }
    const log = [];
    const code = await run(deps(log, { remoteSha: 'newsha1' }));
    expect(code).toBe(0);
    const kept = ['newsha1', 'oldsha0', 'stale6', 'stale5', 'stale4'];
    const pruned = ['stale1', 'stale2', 'stale3'];
    for (const name of kept) expect(existsSync(join(releases, name))).toBe(true);
    for (const name of pruned) expect(existsSync(join(releases, name))).toBe(false);
    expect(existsSync(stateDir)).toBe(true);
  });

  // Remote store mode: the unit's --env-file names KIOSK_STATUS_URL and the
  // read token; every run reports what it did so the agent diagnoses without
  // SSH.
  const STATUS_URL = 'https://api.plow.co/v1/kiosks/kio_1/status';
  const statusEnv = { KIOSK_STATUS_URL: STATUS_URL, DASHBOARD_TOKEN: 'rt_secret' };
  const statusPut = (calls) => calls.find((c) => c.url === STATUS_URL);

  it.each([
    ['after a deploy', { remoteSha: 'newsha1' }, { sha: 'newsha1', action: 'deployed' }],
    // Bootstrap release live (no version.json yet): sha stays null until the first real flip.
    ['on a noop tick', { remoteSha: 'oldsha0' }, { sha: null, action: 'noop' }],
  ])('PUTs {sha, deployed_at, last_result} to KIOSK_STATUS_URL %s', async (_name, opts, want) => {
    const calls = [];
    expect(await run(deps([], { ...opts, env: statusEnv }, calls))).toBe(0);
    const put = statusPut(calls);
    expect(put.init.method).toBe('PUT');
    expect(put.init.headers.authorization).toBe('Bearer rt_secret');
    expect(put.init.redirect).toBe('error');
    const body = JSON.parse(put.init.body);
    expect(body.sha).toBe(want.sha);
    expect(typeof body.deployed_at === 'string' || body.deployed_at === null).toBe(true);
    expect(body.last_result).toMatchObject({ action: want.action, ok: true });
  });

  it('a failed status report is logged, never fatal — the deploy still counts', async () => {
    const calls = [];
    const code = await run(
      deps(
        [],
        { remoteSha: 'newsha1', net: { liveSha: 'newsha1', statusOk: false }, env: statusEnv },
        calls,
      ),
    );
    expect(code).toBe(0);
    expect(await readlink(current)).toBe(join(releases, 'newsha1'));
    const result = JSON.parse(await readFile(join(stateDir, 'last-result.json'), 'utf8'));
    expect(result).toMatchObject({ action: 'deployed', ok: true });
  });

  it('reports nothing when the env has no KIOSK_STATUS_URL (local mode)', async () => {
    const calls = [];
    await run(deps([], { remoteSha: 'newsha1' }, calls));
    expect(calls.some((c) => c.url.startsWith('https://'))).toBe(false);
  });

  it('reports nothing when KIOSK_STATUS_URL is set but DASHBOARD_TOKEN is missing (partial env)', async () => {
    const calls = [];
    await run(deps([], { remoteSha: 'newsha1', env: { KIOSK_STATUS_URL: STATUS_URL } }, calls));
    expect(calls.some((c) => c.url === STATUS_URL)).toBe(false);
  });

  it('a status PUT that never resolves does not hang the run past its timeout', async () => {
    const inner = makeFetch({ liveSha: 'newsha1' });
    // Simulates a blackholed KIOSK_STATUS_URL: the promise never settles on
    // its own — only AbortSignal.timeout firing resolves it, same as a real
    // hung TCP connection would.
    const hangingFetch = (url, init) => {
      if (!url.startsWith('https://')) return inner(url, init);
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    };
    const code = await run({
      ...deps([], { remoteSha: 'newsha1', net: { liveSha: 'newsha1' }, env: statusEnv }),
      fetch: hangingFetch,
      statusTimeoutMs: 5, // real ms, but tiny — no 10 s test sleep
    });
    // The deploy itself succeeds; only the status report timed out and was logged.
    expect(code).toBe(0);
    expect(await readlink(current)).toBe(join(releases, 'newsha1'));
  });

  it('a corrupt version.json fails the status report loudly instead of reporting sha: null', async () => {
    // Live release already flipped with a bad stamp on disk (simulates a
    // torn write); the noop tick should still try to report and fail loudly.
    await writeFile(join(releases, 'oldsha0', 'version.json'), '{not json');
    const calls = [];
    const code = await run(deps([], { remoteSha: 'oldsha0', env: statusEnv }, calls));
    expect(code).toBe(0); // the noop action itself still succeeds
    expect(statusPut(calls)).toBeUndefined(); // reportStatus threw before the PUT
  });
});
