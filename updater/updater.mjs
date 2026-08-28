// Pi-side git-pull updater: fetch the household repo, build a fresh release,
// health-check it, atomically flip ~/ld-current, and roll back on failure.
// Runs as a systemd user oneshot every 2 min (see the units in this dir);
// updater/README.md documents the release-dir / symlink / state contract.
//
// Every side effect goes through the injected exec/spawn/fetch/sleep so the
// decision logic is testable on any host (updater.test.mjs) — node stdlib only.
import { execFile as execFileCb, spawn as spawnCb } from 'node:child_process';
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const VIEWER_UNIT = 'life-dashboard-viewer';
const PROBE_PORT = 5199;
const LIVE_PORT = 5174;
// /api/feeds does not exist on this server; these three do, unconditionally.
const HEALTH_PATHS = ['/healthz', '/', '/api/version'];
const KEEP_RELEASES = 5;
// Shared per-household state, symlinked into every release so a flip never
// loses it: .env (secrets), data/ (messages), banners/ (photos).
const SHARED = ['.env', 'data', 'banners'];

const realExec = (argv, opts = {}) =>
  new Promise((resolve) => {
    execFileCb(
      argv[0],
      argv.slice(1),
      { cwd: opts.cwd, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) =>
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        }),
    );
  });

const realSpawn = (argv, opts = {}) => {
  const child = spawnCb(argv[0], argv.slice(1), {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  // Only the tail ever reaches last-result.json; cap accumulation so a
  // crash-looping probe can't balloon memory during the health-check window.
  child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-65536)));
  return { kill: () => child.kill(), stderr: () => stderr };
};

// Failures land in last-result.json as the agent's only remote diagnostic, so
// carry the tail of whatever the failing step said.
const tail = (s) => (s ?? '').trim().slice(-2000);

async function healthy(doFetch, base, paths, sleep, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const results = await Promise.all(paths.map((p) => doFetch(base + p)));
      if (results.every((r) => r.ok)) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

async function liveShaIs(doFetch, sha, sleep, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await doFetch(`http://127.0.0.1:${LIVE_PORT}/api/version`);
      if (res.ok && (await res.json()).sha === sha) return true;
    } catch {
      /* restarting */
    }
    await sleep(500);
  }
  return false;
}

// Atomic symlink flip: create-then-rename, so ld-current always points at a
// complete release (ln -sfn semantics without the unlink/create window).
async function flipTo(current, target) {
  const tmp = `${current}.new`;
  await rm(tmp, { force: true });
  await symlink(target, tmp);
  await rename(tmp, current);
}

export async function run(deps = {}) {
  const {
    home = os.homedir(),
    exec = realExec,
    spawn = realSpawn,
    fetch: doFetch = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => new Date(),
    log = (m) => console.log(m),
  } = deps;

  const releases = join(home, 'ld-releases');
  const stateDir = join(releases, 'state');
  const current = join(home, 'ld-current');
  await mkdir(stateDir, { recursive: true });

  const finish = async (code, result) => {
    await writeFile(
      join(stateDir, 'last-result.json'),
      JSON.stringify({ at: now().toISOString(), ok: code === 0, ...result }, null, 2) + '\n',
    );
    log(`updater: ${result.action} (${result.sha ?? 'no sha'})${result.detail ? ` — ${result.detail}` : ''}`);
    return code;
  };

  const currentDir = await readlink(current); // no symlink = not bootstrapped; fail loudly
  const restart = () => exec(['systemctl', '--user', 'restart', VIEWER_UNIT]);

  // 1. What does the household repo want deployed?
  const fetched = await exec(['git', 'fetch'], { cwd: currentDir });
  if (fetched.code !== 0) return finish(1, { action: 'fetch-failed', sha: null });
  const revParse = await exec(['git', 'rev-parse', 'origin/main'], { cwd: currentDir });
  if (revParse.code !== 0) return finish(1, { action: 'rev-parse-failed', sha: null });
  const sha = revParse.stdout.trim();

  // 2. Nothing new, or a SHA already proven bad → done until the next push.
  if (sha === basename(currentDir)) return finish(0, { action: 'noop', sha });
  const badShaFile = join(stateDir, 'bad-sha');
  const pinned = existsSync(badShaFile) ? await readFile(badShaFile, 'utf8') : '';
  if (pinned.split('\n').includes(sha)) return finish(0, { action: 'skipped-bad-sha', sha });

  // Pre-flip failures finish UNPINNED: a transient clone/registry/build hiccup
  // retries on the next tick instead of wedging the household on the old
  // dashboard until someone pushes again. bad-sha is reserved for the one case
  // that already reached the wall and had to be undone (post-flip rollback).
  const pin = () => appendFile(badShaFile, `${sha}\n`);
  const fail = (action, detail) => finish(1, { action, sha, detail });

  // 3. Fresh release dir: clone at the SHA, build, test.
  const releaseDir = join(releases, sha);
  await rm(releaseDir, { recursive: true, force: true }); // leftover from a killed run
  await mkdir(releaseDir, { recursive: true });
  const origin = await exec(['git', 'config', '--get', 'remote.origin.url'], { cwd: currentDir });
  const cloned = await exec(['git', 'clone', origin.stdout.trim(), releaseDir]);
  if (cloned.code !== 0)
    return fail('build-failed', `git clone: ${tail(cloned.stderr || cloned.stdout)}`);

  // Shared household state (secrets, messages, photos) lives outside the
  // release dirs and is symlinked into each one — before the build/test steps,
  // so nothing downstream can depend on it being absent.
  for (const name of SHARED) {
    const source = join(home, 'ld-data', name);
    if (existsSync(source)) await symlink(source, join(releaseDir, name));
  }

  for (const argv of [['git', 'checkout', sha], ['npm', 'ci'], ['npm', 'run', 'build'], ['npm', 'test']]) {
    const res = await exec(argv, { cwd: releaseDir });
    if (res.code !== 0)
      return fail('build-failed', `${argv.join(' ')}: ${tail(res.stderr || res.stdout)}`);
  }

  // 4. Boot the built release on the probe port and health-check it.
  const probe = spawn(['node', '--env-file=.env', 'server.js'], {
    cwd: releaseDir,
    env: { PORT: String(PROBE_PORT) },
  });
  const probeOk = await healthy(doFetch, `http://127.0.0.1:${PROBE_PORT}`, HEALTH_PATHS, sleep, 20);
  probe.kill();
  if (!probeOk) return fail('probe-failed', tail(probe.stderr?.()));

  // 5. Stamp, flip, restart, re-check live.
  await writeFile(
    join(releaseDir, 'version.json'),
    JSON.stringify({ sha, deployedAt: now().toISOString() }) + '\n',
  );
  await flipTo(current, releaseDir);
  await restart();
  const liveOk =
    (await healthy(doFetch, `http://127.0.0.1:${LIVE_PORT}`, HEALTH_PATHS, sleep, 20)) &&
    (await liveShaIs(doFetch, sha, sleep, 20));
  if (!liveOk) {
    // Roll back: previous release is still on disk; flip the symlink home.
    await flipTo(current, currentDir);
    await restart();
    await pin(); // proven bad on the wall — never auto-retry this SHA
    return fail('rolled-back', 'post-flip health check failed');
  }

  // 6. Prune to the newest releases (never state/, never the live one).
  const entries = (await readdir(releases)).filter((n) => n !== 'state');
  const dated = await Promise.all(
    entries.map(async (n) => ({ n, mtime: (await stat(join(releases, n))).mtimeMs })),
  );
  dated.sort((a, b) => b.mtime - a.mtime);
  for (const { n } of dated.slice(KEEP_RELEASES)) {
    if (n === sha) continue;
    await rm(join(releases, n), { recursive: true, force: true });
  }

  return finish(0, { action: 'deployed', sha });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await run());
}
