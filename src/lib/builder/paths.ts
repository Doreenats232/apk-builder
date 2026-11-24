import path from "node:path";

// Where uploaded zips, extracted work folders and finished artifacts live.
// Override with BUILDER_DATA_DIR if you want them somewhere else.
export const DATA_DIR = process.env.BUILDER_DATA_DIR
  ? path.resolve(process.env.BUILDER_DATA_DIR)
  : path.join(process.cwd(), "data");

export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const WORK_DIR = path.join(DATA_DIR, "work");
export const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
