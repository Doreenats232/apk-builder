import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getBuild, recoverStale, updateBuild, type BuildRow } from "./store";
import { extractZip } from "./extract";
import { ANDROID_MARKERS, NODE_MARKERS, exists, findFiles, findProjectRoot, newestFirst } from "./detect";
import { ARTIFACTS_DIR, WORK_DIR } from "./paths";
import { androidSdkPath, hasJava } from "./toolchain";

// ---------------------------------------------------------------------------
// Job queue. Kept on globalThis so every route bundle shares the same state.
// Builds run one at a time to keep the server from thrashing.
// ---------------------------------------------------------------------------

type JobState = { active: Set<number>; queue: Promise<void> };
const g = globalThis as typeof globalThis & { __apkMakerJobs?: JobState };
const jobs: JobState = (g.__apkMakerJobs ??= { active: new Set<number>(), queue: Promise.resolve() });

export function isBuildActive(id: number): boolean {
  return jobs.active.has(id);
}

export function enqueueBuild(id: number): void {
  jobs.active.add(id);
  jobs.queue = jobs.queue
    .then(() => runBuild(id))
    .catch((err) => console.error("[builder] unexpected failure", err));
}

/** Marks builds that were left queued/running by a previous server process as failed. */
export async function recoverStaleBuilds(): Promise<void> {
  await recoverStale([...jobs.active]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Log = (line: string) => void;
type StageFn = (text: string) => Promise<unknown>;
type Artifact = { file: string; filename: string; projectType: string };
type PkgJson = {
  main?: string;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const MAX_LOG_LINES = 20_000;
const rel = (from: string, to: string) => path.relative(from, to) || ".";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
}

/** Runs a command, streaming each output line into the build log. Rejects on non-zero exit. */
function runStep(
  cmd: string,
  args: string[],
  opts: { cwd: string; log: Log; timeoutMs?: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    opts.log(`$ ${cmd} ${args.join(" ")}`);

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    const timer = setTimeout(() => {
      opts.log("Timed out — killing process");
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 30 * 60_000);

    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) opts.log(line);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start "${cmd}": ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`"${cmd} ${args[0] ?? ""}" failed with exit code ${code}`));
    });
  });
}

// ---------------------------------------------------------------------------
// APK: Android Gradle project -> debug APK
// ---------------------------------------------------------------------------

async function buildApk(workDir: string, name: string, log: Log, stage: StageFn): Promise<Artifact> {
  const root = await findProjectRoot(workDir, ANDROID_MARKERS);
  if (!root) {
    throw new Error(
      "No Android Gradle project found in the zip. Expected settings.gradle(.kts) or build.gradle(.kts) in the archive.",
    );
  }
  log(`Android Gradle project found at ${rel(workDir, root)}`);

  const java = await hasJava();
  if (!java.ok) {
    throw new Error("Java JDK not found on this server. Install JDK 17+, set JAVA_HOME, then rebuild.");
  }

  const sdk = androidSdkPath();
  if (!sdk || !(await exists(sdk))) {
    throw new Error("Android SDK not found on this server. Install it, set ANDROID_HOME, then rebuild.");
  }

  await stage("Preparing Gradle project");
  const localProps = path.join(root, "local.properties");
  if (!(await exists(localProps))) {
    const escaped = sdk.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
    await fs.writeFile(localProps, `sdk.dir=${escaped}\n`);
    log(`Wrote local.properties (sdk.dir=${sdk})`);
  }

  const wrapper = path.join(root, "gradlew");
  let gradleCmd = "gradle";
  if (await exists(wrapper)) {
    await fs.chmod(wrapper, 0o755).catch(() => {});
    gradleCmd = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  }

  await stage("Building debug APK with Gradle (this can take several minutes)");
  await runStep(gradleCmd, ["assembleDebug", "--no-daemon", "--console=plain"], {
    cwd: root,
    log,
    timeoutMs: 45 * 60_000,
  });

  const apks = await findFiles(root, (f) => f.endsWith(".apk") && /[\\/]outputs[\\/]apk[\\/]/.test(f));
  if (apks.length === 0) {
    throw new Error("Gradle finished but no APK was produced under build/outputs/apk.");
  }
  const [newest] = await newestFirst(apks);
  return { file: newest, filename: `${slugify(name)}.apk`, projectType: "android" };
}

// ---------------------------------------------------------------------------
// EXE: Node.js or Electron project -> Windows .exe
// ---------------------------------------------------------------------------

async function buildExe(workDir: string, name: string, log: Log, stage: StageFn): Promise<Artifact> {
  const root = await findProjectRoot(workDir, NODE_MARKERS);
  if (!root) {
    throw new Error("No package.json found in the zip. The EXE target needs a Node.js or Electron project.");
  }
  log(`Node.js project found at ${rel(workDir, root)}`);

  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as PkgJson;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const isElectron = "electron" in deps;
  const slug = slugify(name);
  const outDir = path.join(root, "dist-exe");
  await fs.mkdir(outDir, { recursive: true });

  const opts = { cwd: root, log, timeoutMs: 45 * 60_000 };

  await stage("Installing npm dependencies");
  const install = () => runStep("npm", ["install", "--no-audit", "--no-fund"], opts);
  if (await exists(path.join(root, "package-lock.json"))) {
    try {
      await runStep("npm", ["ci", "--no-audit", "--no-fund"], opts);
    } catch {
      log("npm ci failed — retrying with npm install");
      await install();
    }
  } else {
    await install();
  }

  if (pkg.scripts?.build) {
    await stage("Running npm run build");
    await runStep("npm", ["run", "build"], opts);
  }

  if (isElectron) {
    await stage("Packaging Electron app for Windows (electron-builder, portable .exe)");
    await runStep(
      "npx",
      ["--yes", "electron-builder", "--win", "portable", "--x64", `--config.directories.output=${outDir}`],
      opts,
    );
    const exes = await findFiles(outDir, (f) => f.toLowerCase().endsWith(".exe"), 2);
    if (exes.length === 0) throw new Error("electron-builder finished but produced no .exe file.");
    const [newest] = await newestFirst(exes);
    return { file: newest, filename: `${slug}.exe`, projectType: "electron" };
  }

  let entry = pkg.main ?? "index.js";
  if (typeof pkg.bin === "string") entry = pkg.bin;
  else if (pkg.bin && Object.values(pkg.bin)[0]) entry = Object.values(pkg.bin)[0];

  if (!(await exists(path.join(/*turbopackIgnore: true*/ root, entry)))) {
    throw new Error(`Entry file "${entry}" not found. Set "main" or "bin" in package.json to your entry script.`);
  }

  await stage(`Packaging ${entry} into a standalone Windows .exe (pkg)`);
  const exeFile = path.join(outDir, `${slug}.exe`);
  await runStep("npx", ["--yes", "@yao-pkg/pkg", entry, "--targets", "node22-win-x64", "--output", exeFile], opts);
  if (!(await exists(exeFile))) throw new Error("pkg finished but the .exe was not created.");

  return { file: exeFile, filename: `${slug}.exe`, projectType: "node" };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function runBuild(id: number): Promise<void> {
  const build = await getBuild(id);
  if (!build) {
    jobs.active.delete(id);
    return;
  }

  const lines: string[] = [];
  let dirty = false;
  let chain: Promise<unknown> = Promise.resolve();

  // Writes are chained so they land in order; each write snapshots the current log.
  const save = (patch: Partial<BuildRow> = {}) => {
    dirty = false;
    chain = chain
      .then(() =>
        updateBuild(id, { ...patch, log: lines.join("\n") }),
      )
      .catch((err) => console.error("[builder] failed to save progress", err));
    return chain;
  };

  const log: Log = (line) => {
    const clean = line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
    lines.push(`[${new Date().toISOString().slice(11, 19)}] ${clean}`);
    if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
    dirty = true;
  };

  const stage: StageFn = (text) => {
    log(`== ${text}`);
    return save({ status: "running", stage: text });
  };

  const flushTimer = setInterval(() => {
    if (dirty) void save();
  }, 1500);

  const workDir = path.join(WORK_DIR, String(id));

  try {
    await fs.rm(workDir, { recursive: true, force: true });
    await stage("Extracting zip");
    const count = await extractZip(build.zipPath, workDir);
    log(`Extracted ${count} files from ${build.originalFilename}`);

    const artifact =
      build.target === "apk"
        ? await buildApk(workDir, build.name, log, stage)
        : await buildExe(workDir, build.name, log, stage);

    await stage("Saving artifact");
    const outDir = path.join(ARTIFACTS_DIR, String(id));
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(outDir, { recursive: true });
    const artifactPath = path.join(outDir, artifact.filename);
    await fs.copyFile(artifact.file, artifactPath);
    const sizeMb = ((await fs.stat(artifactPath)).size / 1024 / 1024).toFixed(1);
    log(`Artifact ready: ${artifact.filename} (${sizeMb} MB)`);
    log("BUILD SUCCEEDED");

    await save({
      status: "success",
      stage: "Done",
      projectType: artifact.projectType,
      artifactPath,
      artifactName: artifact.filename,
      finishedAt: new Date(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    await save({ status: "failed", stage: "Failed", errorMessage: message, finishedAt: new Date() });
  } finally {
    clearInterval(flushTimer);
    await chain;
    jobs.active.delete(id);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
