// Save storage. Primary: the artifact's private per-player db document
// (data/users/<id>/<key>, needs the `db` and `user` capabilities). Fallback:
// localStorage. Last resort: memory only. Every backend stores a JSON string.

export type BackendName = 'db' | 'local' | 'memory';

export interface KeyValueBackend {
  readonly name: BackendName;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

// Minimal shapes of the claude.ai capability namespaces used here.
interface DbDoc {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
}
interface DbNamespace {
  doc(path: string): DbDoc;
}
interface UserNamespace {
  id(): Promise<string | null>;
}
interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

export class MemoryBackend implements KeyValueBackend {
  readonly name = 'memory' as const;
  private data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
}

export class LocalBackend implements KeyValueBackend {
  readonly name = 'local' as const;
  constructor(private readonly prefix = 'nodebuster-remake.') {}

  static available(): boolean {
    try {
      const k = '__nb_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string) {
    try {
      return localStorage.getItem(this.prefix + key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string) {
    try {
      localStorage.setItem(this.prefix + key, value);
    } catch {
      // Storage full or blocked: the db backend (if any) still has the save.
    }
  }
}

/** One document per key under the viewer's private subtree. Writes are serialised
 * per document and coalesced: only the newest pending value is written. */
export class DbBackend implements KeyValueBackend {
  readonly name = 'db' as const;
  private pending = new Map<string, string>();
  private writing = new Set<string>();

  constructor(
    private readonly db: DbNamespace,
    private readonly uid: string,
  ) {}

  private doc(key: string): DbDoc {
    return this.db.doc(`data/users/${this.uid}/${key}`);
  }

  async get(key: string) {
    const snap = await this.doc(key).get();
    if (!snap.exists) return null;
    const json = snap.data()?.json;
    return typeof json === 'string' ? json : null;
  }

  async set(key: string, value: string) {
    this.pending.set(key, value);
    if (this.writing.has(key)) return;
    this.writing.add(key);
    try {
      while (this.pending.has(key)) {
        const v = this.pending.get(key)!;
        this.pending.delete(key);
        await this.doc(key).set({ json: v, savedAt: Date.now() });
      }
    } finally {
      this.writing.delete(key);
    }
  }
}

/** Writes go to every backend (db first); reads take the first backend that has the key. */
export class SaveStore {
  constructor(readonly backends: KeyValueBackend[]) {}

  get primary(): BackendName {
    return this.backends[0]?.name ?? 'memory';
  }

  async get(key: string): Promise<string | null> {
    for (const b of this.backends) {
      try {
        const v = await b.get(key);
        if (v != null) return v;
      } catch {
        // Try the next backend.
      }
    }
    return null;
  }

  async set(key: string, value: string): Promise<void> {
    await Promise.all(
      this.backends.map(async (b) => {
        try {
          await b.set(key, value);
        } catch {
          // A refused db write (e.g. view-only member) leaves the local copy.
        }
      }),
    );
  }
}

/** Pick backends for this page: db when the artifact host grants it, plus localStorage. */
export async function openSaveStore(host: ClaudeHost | undefined = (globalThis as { claude?: ClaudeHost }).claude): Promise<SaveStore> {
  const backends: KeyValueBackend[] = [];
  if (host?.use) {
    try {
      const [db, user] = (await Promise.all([host.use('db'), host.use('user')])) as [DbNamespace | null, UserNamespace | null];
      const uid = db && user ? await user.id() : null;
      if (db && uid) backends.push(new DbBackend(db, uid));
    } catch {
      // No db for this view.
    }
  }
  if (LocalBackend.available()) backends.push(new LocalBackend());
  if (backends.length === 0) backends.push(new MemoryBackend());
  return new SaveStore(backends);
}

// ---- Export / import strings -------------------------------------------------

const EXPORT_PREFIX = 'NBR1:';

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function checksum(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function exportSaveString(json: string): string {
  return `${EXPORT_PREFIX}${checksum(json)}:${toBase64(json)}`;
}

/** Returns the JSON text, or throws an Error whose message explains what is wrong. */
export function importSaveString(input: string): string {
  const s = input.trim();
  if (!s.startsWith(EXPORT_PREFIX)) throw new Error('This is not a Nodebuster save string. It should start with NBR1:');
  const rest = s.slice(EXPORT_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 0) throw new Error('The save string is incomplete. Copy the whole string and try again.');
  let json: string;
  try {
    json = fromBase64(rest.slice(sep + 1));
  } catch {
    throw new Error('The save string is damaged. Copy the whole string and try again.');
  }
  if (checksum(json) !== rest.slice(0, sep)) throw new Error('The save string is damaged. Copy the whole string and try again.');
  JSON.parse(json);
  return json;
}
