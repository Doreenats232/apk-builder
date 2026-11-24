import { spawn } from "node:child_process";
import path from "node:path";
import { exists } from "./detect";
import type { ToolStatus } from "./types";

/** Runs a command and captures combined stdout+stderr. Never throws. */
export function runCapture(
  cmd: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out });
    };

    const child = spawn(cmd, args, {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", (err) => {
      out += err.message;
      finish(-1);
    });
    child.on("close", (code) => finish(code));
  });
}

export function javaCommand(): string {
  return process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "java") : "java";
}

export function androidSdkPath(): string | null {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || null;
}

export async function hasJava(): Promise<{ ok: boolean; line: string }> {
  const r = await runCapture(javaCommand(), ["-version"]);
  const line = r.out.split("\n").find((l) => l.trim())?.trim() ?? "";
  return { ok: r.code === 0, line };
}

export async function getToolchainStatus(): Promise<ToolStatus[]> {
  const tools: ToolStatus[] = [];

  tools.push({
    id: "node",
    label: "Node.js",
    ok: true,
    required: "exe",
    detail: process.version,
  });

  const npm = await runCapture("npm", ["-v"]);
  tools.push({
    id: "npm",
    label: "npm",
    ok: npm.code === 0,
    required: "exe",
    detail: npm.code === 0 ? `v${npm.out.trim()}` : "Not found",
  });

  const java = await hasJava();
  tools.push({
    id: "java",
    label: "Java JDK (17+)",
    ok: java.ok,
    required: "apk",
    detail: java.ok ? java.line : "Not found — install a JDK and set JAVA_HOME",
  });

  const sdk = androidSdkPath();
  const sdkOk = !!sdk && (await exists(sdk));
  tools.push({
    id: "android-sdk",
    label: "Android SDK",
    ok: sdkOk,
    required: "apk",
    detail: sdkOk ? (sdk as string) : "Not found — set ANDROID_HOME to your SDK folder",
  });

  const wine = await runCapture("wine", ["--version"], 5_000);
  tools.push({
    id: "wine",
    label: "Wine (only for Electron builds on Linux)",
    ok: wine.code === 0,
    required: "exe",
    detail: wine.code === 0 ? wine.out.trim() : "Not found (optional)",
  });

  return tools;
}
