import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_ENTRIES = 50_000;
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB safety cap

/**
 * Extracts a zip into destDir. Rejects entries that try to escape destDir
 * (zip-slip) and archives that unpack to an absurd size (zip bombs).
 * Returns the number of files written.
 */
export async function extractZip(zipPath: string, destDir: string): Promise<number> {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Zip has too many entries (${entries.length} > ${MAX_ENTRIES})`);
  }

  const total = entries.reduce((sum, e) => sum + (e.header.size || 0), 0);
  if (total > MAX_UNPACKED_BYTES) {
    throw new Error("Zip unpacks to more than 2 GB — refusing to extract");
  }

  const root = path.resolve(destDir);
  await fs.mkdir(root, { recursive: true });

  let written = 0;
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, "/");
    if (name.startsWith("__MACOSX/") || name.endsWith(".DS_Store")) continue;

    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Unsafe path inside zip: ${entry.entryName}`);
    }

    if (entry.isDirectory) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.getData());
    written++;
  }

  return written;
}
