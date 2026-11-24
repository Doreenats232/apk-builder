import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./paths";

// Tiny file-based store (no database needed). Metadata lives in data/builds.json,
// each build's log lives in data/logs/<id>.log so frequent log writes stay cheap.

export type BuildRow = {
  id: number;
  name: string;
  target: string; // "apk" | "exe"
  originalFilename: string;
  zipPath: string;
  sizeBytes: number | null;
  projectType: string | null;
  status: string; // queued | running | success | failed
  stage: string | null;
  log: string;
  artifactPath: string | null;
  artifactName: string | null;
  errorMessage: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

type Meta = Omit<BuildRow, "log" | "createdAt" | "finishedAt"> & { createdAt: string; finishedAt: string | null };
type State = { nextId: number; builds: Meta[]; queue: Promise<unknown> };

const DB_FILE = path.join(DATA_DIR, "builds.json");
const LOG_DIR = path.join(DATA_DIR, "logs");

const g = globalThis as typeof globalThis & { __apkStore?: Promise<State> };

function load(): Promise<State> {
  return (g.__apkStore ??= (async () => {
    await fs.mkdir(LOG_DIR, { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(DB_FILE, "utf8")) as { nextId: number; builds: Meta[] };
      return { nextId: raw.nextId, builds: raw.builds, queue: Promise.resolve() };
    } catch {
      return { nextId: 1, builds: [], queue: Promise.resolve() };
    }
  })());
}

// Writes are serialized and atomic (temp file + rename).
function persist(s: State): Promise<unknown> {
  const snapshot = JSON.stringify({ nextId: s.nextId, builds: s.builds });
  s.queue = s.queue
    .then(async () => {
      const tmp = `${DB_FILE}.tmp`;
      await fs.writeFile(tmp, snapshot);
      await fs.rename(tmp, DB_FILE);
    })
    .catch((err) => console.error("[store] failed to save", err));
  return s.queue;
}

const toRow = (m: Meta, log = ""): BuildRow => ({
  ...m,
  log,
  createdAt: new Date(m.createdAt),
  finishedAt: m.finishedAt ? new Date(m.finishedAt) : null,
});

export type NewBuild = Pick<BuildRow, "name" | "target" | "originalFilename" | "zipPath" | "sizeBytes" | "status" | "stage">;

export async function insertBuild(v: NewBuild): Promise<BuildRow> {
  const s = await load();
  const meta: Meta = {
    id: s.nextId++,
    ...v,
    projectType: null,
    artifactPath: null,
    artifactName: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  s.builds.push(meta);
  await persist(s);
  return toRow(meta);
}

export async function listBuilds(limit = 100): Promise<BuildRow[]> {
  const s = await load();
  return [...s.builds].sort((a, b) => b.id - a.id).slice(0, limit).map((m) => toRow(m));
}

export async function getBuild(id: number): Promise<BuildRow | null> {
  const s = await load();
  const m = s.builds.find((b) => b.id === id);
  if (!m) return null;
  const log = await fs.readFile(path.join(LOG_DIR, `${id}.log`), "utf8").catch(() => "");
  return toRow(m, log);
}

export async function updateBuild(id: number, patch: Partial<BuildRow>): Promise<void> {
  const s = await load();
  const m = s.builds.find((b) => b.id === id);
  if (!m) return;
  const { log, createdAt: _c, finishedAt, ...rest } = patch;
  Object.assign(m, rest);
  if (finishedAt !== undefined) m.finishedAt = finishedAt ? finishedAt.toISOString() : null;
  if (log !== undefined) await fs.writeFile(path.join(LOG_DIR, `${id}.log`), log).catch(() => {});
  await persist(s);
}

export async function deleteBuild(id: number): Promise<void> {
  const s = await load();
  s.builds = s.builds.filter((b) => b.id !== id);
  await fs.rm(path.join(LOG_DIR, `${id}.log`), { force: true }).catch(() => {});
  await persist(s);
}

/** Marks builds left queued/running by a previous server process as failed. */
export async function recoverStale(activeIds: number[]): Promise<void> {
  const s = await load();
  let changed = false;
  for (const m of s.builds) {
    if ((m.status === "queued" || m.status === "running") && !activeIds.includes(m.id)) {
      m.status = "failed";
      m.stage = "Interrupted";
      m.errorMessage = "The build was interrupted because the app restarted. Upload it again.";
      m.finishedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await persist(s);
}
