import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Latest message per card slot: a chatty producer can never evict another
// card's content. The whole store is one small JSON object held in memory and
// rewritten atomically on every put — single process, tiny payload, no locking
// needed.
export async function createFileStore(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let byCard = Object.create(null);
  try {
    byCard = Object.assign(Object.create(null), JSON.parse(await readFile(path, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // corrupt file should fail loud, not wipe
  }
  // Serialize writes: two concurrent put()s share the same .tmp path; the
  // loser's rename would throw (tmp already moved by the winner). Chain on a
  // single promise so each write waits for the previous one to finish.
  // The chain is kept healthy by swallowing rejections on the shared tail
  // (writes = p.catch(noop)) — a failed write still rejects to its caller via
  // p, but the next put() chains off a resolved promise, not a poisoned one.
  let writes = Promise.resolve();
  // Shared tmp+rename write, queued behind any write in flight: two
  // concurrent writes share the same .tmp path, so the loser's rename would
  // throw (tmp already moved by the winner). `buildNext` computes the map to
  // persist from the current `byCard` — put() merges one key in, replace()
  // swaps the whole thing.
  const queueWrite = (buildNext) => {
    const write = async () => {
      const next = buildNext();
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
      await rename(tmp, path);
      byCard = next;
    };
    const p = writes.then(write);
    // Swallow rejections on the shared tail so a failed write still rejects
    // to its own caller (via p) without poisoning the chain for the next call.
    writes = p.catch(() => {});
    return p;
  };
  return {
    async get(card) {
      return Object.prototype.hasOwnProperty.call(byCard, card) ? byCard[card] : null;
    },
    put(message) {
      return queueWrite(() => {
        const next = Object.assign(Object.create(null), byCard);
        next[message.card] = message;
        return next;
      });
    },
    // Commit the complete snapshot in one atomic write: any card absent from
    // it is dropped, never left stale from a prior put().
    replace(byCardSnapshot) {
      return queueWrite(() => Object.assign(Object.create(null), byCardSnapshot));
    },
  };
}
