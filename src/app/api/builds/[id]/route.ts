import fs from "node:fs/promises";
import path from "node:path";
import { deleteBuild, getBuild } from "@/lib/builder/store";
import { isBuildActive } from "@/lib/builder/pipeline";
import { ARTIFACTS_DIR, WORK_DIR } from "@/lib/builder/paths";
import { jsonError, toSummary } from "@/lib/builder/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(404, "Build not found.");

  const row = await getBuild(id);
  if (!row) return jsonError(404, "Build not found.");

  return Response.json({ ...toSummary(row), log: row.log });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(404, "Build not found.");

  if (isBuildActive(id)) {
    return jsonError(409, "This build is still running. Wait for it to finish before deleting.");
  }

  const row = await getBuild(id);
  if (!row) return jsonError(404, "Build not found.");

  await deleteBuild(id);
  await Promise.all([
    fs.rm(row.zipPath, { force: true }).catch(() => {}),
    fs.rm(path.join(ARTIFACTS_DIR, String(id)), { recursive: true, force: true }).catch(() => {}),
    fs.rm(path.join(WORK_DIR, String(id)), { recursive: true, force: true }).catch(() => {}),
  ]);

  return Response.json({ ok: true });
}
