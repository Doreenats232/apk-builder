// Shared types (safe to import from client components — no server-only code here).

export type BuildStatus = "queued" | "running" | "success" | "failed";
export type BuildTarget = "apk" | "exe";

export type BuildSummary = {
  id: number;
  name: string;
  target: BuildTarget;
  originalFilename: string;
  sizeBytes: number | null;
  projectType: string | null;
  status: BuildStatus;
  stage: string | null;
  artifactName: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type BuildDetail = BuildSummary & { log: string };

export type ToolStatus = {
  id: string;
  label: string;
  ok: boolean;
  required: "apk" | "exe" | "both";
  detail: string;
};

export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
