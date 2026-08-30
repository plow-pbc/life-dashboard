import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function createWriteQueue(path, commit) {
  let writes = Promise.resolve();
  return (buildNext) => {
    const write = async () => {
      const next = buildNext();
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
      await rename(tmp, path);
      commit(next);
    };
    const pending = writes.then(write);
    writes = pending.catch(() => {});
    return pending;
  };
}

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
  // `buildNext` runs inside the shared write queue so concurrent updates see
  // the latest committed value and never race on the one .tmp path.
  const queueWrite = createWriteQueue(path, (next) => {
    byCard = next;
  });
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
  };
}

export async function createDocumentStore(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let document = null;
  try {
    document = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const queueWrite = createWriteQueue(path, (next) => {
    document = next;
  });
  return {
    async get() {
      return document;
    },
    replace(next) {
      return queueWrite(() => next);
    },
  };
}
