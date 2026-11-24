import fs from "node:fs/promises";
import { getBuild } from "@/lib/builder/store";
import { jsonError } from "@/lib/builder/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const n = Number((await params).id);
  if (!Number.isInteger(n) || n <= 0) return jsonError(404, "Build not found.");

  const row = await getBuild(n);
  if (!row || row.status !== "success" || !row.artifactPath || !row.artifactName) {
    return jsonError(404, "Artifact is not ready.");
  }

  const data = await fs.readFile(row.artifactPath).catch(() => null);
  if (!data) return jsonError(404, "Artifact file is missing on disk.");

  const mime = row.artifactName.endsWith(".apk")
    ? "application/vnd.android.package-archive"
    : "application/vnd.microsoft.portable-executable";

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(data.length),
      "Content-Disposition": `attachment; filename="${row.artifactName.replace(/"/g, "")}"`,
    },
  });
}
