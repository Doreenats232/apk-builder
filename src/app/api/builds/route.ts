import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { insertBuild, listBuilds } from "@/lib/builder/store";
import { enqueueBuild, recoverStaleBuilds } from "@/lib/builder/pipeline";
import { UPLOADS_DIR } from "@/lib/builder/paths";
import { MAX_UPLOAD_BYTES } from "@/lib/builder/types";
import { jsonError, toSummary } from "@/lib/builder/serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  await recoverStaleBuilds();
  const rows = await listBuilds(100);
  return Response.json(rows.map(toSummary));
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Expected a multipart form upload.");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return jsonError(400, "Choose a .zip file to upload.");
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return jsonError(400, "Only .zip files are supported.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, "That file is larger than 300 MB.");
  }

  const targetRaw = String(form.get("target") ?? "");
  if (targetRaw !== "apk" && targetRaw !== "exe") {
    return jsonError(400, "Target must be 'apk' or 'exe'.");
  }

  const data = Buffer.from(await file.arrayBuffer());
  // ZIP files start with the "PK" signature.
  if (data[0] !== 0x50 || data[1] !== 0x4b) {
    return jsonError(400, "That file is not a valid zip archive.");
  }

  const rawName = String(form.get("name") ?? "").trim();
  const name = (rawName || file.name.replace(/\.zip$/i, "")).slice(0, 80);

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const zipPath = path.join(UPLOADS_DIR, `${randomUUID()}.zip`);
  await fs.writeFile(zipPath, data);

  const row = await insertBuild({
    name,
    target: targetRaw,
    originalFilename: file.name,
    zipPath,
    sizeBytes: file.size,
    status: "queued",
    stage: "Queued",
  });

  enqueueBuild(row.id);
  return Response.json(toSummary(row), { status: 201 });
}
