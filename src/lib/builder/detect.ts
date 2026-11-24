import fs from "node:fs/promises";
import path from "node:path";

export const ANDROID_MARKERS = ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"];
export const NODE_MARKERS = ["package.json"];

const SKIP_DIRS = new Set(["node_modules", ".git", ".gradle", "dist", "dist-exe", ".next"]);
const MAX_DEPTH = 3;

/**
 * Breadth-first search for the shallowest folder containing one of `markers`.
 * Returns null if nothing is found within MAX_DEPTH levels.
 */
export async function findProjectRoot(baseDir: string, markers: string[]): Promise<string | null> {
  let queue: { dir: string; depth: number }[] = [{ dir: baseDir, depth: 0 }];

  while (queue.length > 0) {
    const next: { dir: string; depth: number }[] = [];

    for (const { dir, depth } of queue) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      if (entries.some((e) => e.isFile() && markers.includes(e.name))) {
        return dir;
      }
      if (depth < MAX_DEPTH) {
        for (const e of entries) {
          if (e.isDirectory() && !SKIP_DIRS.has(e.name) && e.name !== "__MACOSX") {
            next.push({ dir: path.join(dir, e.name), depth: depth + 1 });
          }
        }
      }
    }

    queue = next;
  }

  return null;
}

/** Recursively finds files whose full path matches `predicate`. */
export async function findFiles(
  dir: string,
  predicate: (fullPath: string) => boolean,
  maxDepth = 10,
  depth = 0,
): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < maxDepth && !SKIP_DIRS.has(e.name)) {
        results.push(...(await findFiles(full, predicate, maxDepth, depth + 1)));
      }
    } else if (e.isFile() && predicate(full)) {
      results.push(full);
    }
  }

  return results;
}

export async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

/** Newest file first, by modification time. */
export async function newestFirst(files: string[]): Promise<string[]> {
  const stats = await Promise.all(
    files.map(async (f) => ({ f, t: (await fs.stat(f)).mtimeMs })),
  );
  return stats.sort((a, b) => b.t - a.t).map((s) => s.f);
}
