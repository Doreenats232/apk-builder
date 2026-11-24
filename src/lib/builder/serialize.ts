import type { BuildRow } from "./store";
import type { BuildSummary } from "./types";

type SummarySource = Pick<
  BuildRow,
  | "id"
  | "name"
  | "target"
  | "originalFilename"
  | "sizeBytes"
  | "projectType"
  | "status"
  | "stage"
  | "artifactName"
  | "errorMessage"
  | "createdAt"
  | "finishedAt"
>;

/** Converts a DB row into the JSON shape the UI expects. */
export function toSummary(b: SummarySource): BuildSummary {
  return {
    id: b.id,
    name: b.name,
    target: b.target === "exe" ? "exe" : "apk",
    originalFilename: b.originalFilename,
    sizeBytes: b.sizeBytes,
    projectType: b.projectType,
    status: b.status as BuildSummary["status"],
    stage: b.stage,
    artifactName: b.artifactName,
    errorMessage: b.errorMessage,
    createdAt: b.createdAt.toISOString(),
    finishedAt: b.finishedAt ? b.finishedAt.toISOString() : null,
  };
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
