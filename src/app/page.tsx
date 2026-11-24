"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  MAX_UPLOAD_BYTES,
  type BuildDetail,
  type BuildStatus,
  type BuildSummary,
  type BuildTarget,
  type ToolStatus,
} from "@/lib/builder/types";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function formatBytes(n: number | null | undefined): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function StatusBadge({ status }: { status: BuildStatus }) {
  const styles: Record<BuildStatus, string> = {
    queued: "bg-slate-200 text-slate-700",
    running: "bg-amber-100 text-amber-800",
    success: "bg-emerald-100 text-emerald-800",
    failed: "bg-rose-100 text-rose-800",
  };
  const labels: Record<BuildStatus, string> = {
    queued: "Queued",
    running: "Building",
    success: "Success",
    failed: "Failed",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />}
      {labels[status]}
    </span>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

function UploadCard({ onCreated }: { onCreated: (build: BuildSummary) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState<BuildTarget>("apk");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = (f: File | null | undefined) => {
    setError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setError("Only .zip files are supported.");
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError("That file is larger than 300 MB.");
      return;
    }
    setFile(f);
    setName((prev) => prev || f.name.replace(/\.zip$/i, ""));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("target", target);
      fd.append("name", name);
      const res = await fetch("/api/builds", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      onCreated(data as BuildSummary);
      setFile(null);
      setName("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Card title="Make a build" subtitle="Zip up your project folder, drop it here, and pick what you want.">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files[0]);
          }}
          className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          {file ? (
            <>
              <p className="max-w-full truncate font-medium text-slate-900">{file.name}</p>
              <p className="text-sm text-slate-500">{formatBytes(file.size)} · click to change</p>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-900">Drag & drop your project .zip here</p>
              <p className="text-sm text-slate-500">or click to browse · max 300 MB</p>
            </>
          )}
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium text-slate-700">Build target</legend>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {(["apk", "exe"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTarget(t)}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  target === t
                    ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/20"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <span className="block text-sm font-semibold text-slate-900">
                  {t === "apk" ? "Android APK" : "Windows EXE"}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {t === "apk" ? "Gradle project → debug .apk" : "Node.js / Electron → .exe"}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-6 block">
          <span className="text-sm font-medium text-slate-700">App name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="My App"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>

        {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

        <button
          type="submit"
          disabled={!file || busy}
          className="mt-6 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? "Uploading…" : `Build ${target === "apk" ? "APK" : "EXE"}`}
        </button>

        <div className="mt-5 space-y-1 text-xs text-slate-500">
          <p>
            <strong className="text-slate-700">APK:</strong> the zip must contain an Android Gradle project
            (settings.gradle or build.gradle). Produces a debug APK you can sideload.
          </p>
          <p>
            <strong className="text-slate-700">EXE:</strong> the zip must contain a package.json. Electron apps
            become a portable .exe; other Node apps are packed with pkg.
          </p>
        </div>
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Toolchain
// ---------------------------------------------------------------------------

function ToolchainCard({ tools }: { tools: ToolStatus[] | null }) {
  return (
    <Card title="Build server toolchain" subtitle="What this server can build with right now.">
      {tools === null ? (
        <p className="mt-4 text-sm text-slate-500">Checking…</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {tools.map((t) => (
            <li key={t.id} className="flex items-start gap-3">
              <span
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                  t.ok ? "bg-emerald-500" : t.required === "both" ? "bg-rose-500" : "bg-amber-400"
                }`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {t.label}{" "}
                  <span className="text-xs font-normal text-slate-400">
                    · needed for {t.required === "apk" ? "APK" : t.required === "exe" ? "EXE" : "all"} builds
                  </span>
                </p>
                <p className="truncate text-xs text-slate-500" title={t.detail}>
                  {t.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-slate-500">
        Set <code className="rounded bg-slate-100 px-1">JAVA_HOME</code> and{" "}
        <code className="rounded bg-slate-100 px-1">ANDROID_HOME</code> on the server to enable APK builds.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Build list
// ---------------------------------------------------------------------------

function BuildList({
  builds,
  selectedId,
  onSelect,
  onDelete,
}: {
  builds: BuildSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <Card title="Your builds" subtitle="Click a build to see its live log.">
      {builds.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No builds yet. Drop a zip to get started.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {builds.map((b) => (
            <li
              key={b.id}
              className={`flex flex-wrap items-center gap-3 py-3 ${selectedId === b.id ? "bg-indigo-50/60" : ""}`}
            >
              <button type="button" onClick={() => onSelect(b.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-medium text-slate-900">{b.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {b.originalFilename} · {formatBytes(b.sizeBytes)} · {formatDate(b.createdAt)}
                </span>
              </button>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase text-slate-700">
                {b.target}
              </span>
              <StatusBadge status={b.status} />
              {b.status === "success" && b.artifactName && (
                <a
                  href={`/api/builds/${b.id}/artifact`}
                  download={b.artifactName}
                  className="text-sm font-medium text-indigo-600 hover:underline"
                >
                  Download
                </a>
              )}
              <button
                type="button"
                onClick={() => onDelete(b.id)}
                className="text-sm text-slate-400 hover:text-rose-600"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Live detail + log
// ---------------------------------------------------------------------------

function BuildDetailPanel({ id }: { id: number }) {
  const [detail, setDetail] = useState<BuildDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setDetail(null);
    setMissing(false);

    const tick = async () => {
      try {
        const res = await fetch(`/api/builds/${id}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setMissing(true);
          return;
        }
        const data = (await res.json()) as BuildDetail;
        if (cancelled) return;
        setDetail(data);
        if (data.status === "queued" || data.status === "running") {
          timer = setTimeout(tick, 1500);
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, 3000);
      }
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail?.log]);

  if (missing) {
    return (
      <Card title="Build not found">
        <p className="mt-2 text-sm text-slate-500">This build may have been deleted.</p>
      </Card>
    );
  }
  if (!detail) {
    return (
      <Card title="Loading build…">
        <p className="mt-2 text-sm text-slate-500">Fetching the latest log.</p>
      </Card>
    );
  }

  return (
    <Card title={detail.name} subtitle={`#${detail.id} · ${detail.originalFilename} · ${detail.projectType ?? "—"}`}>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <StatusBadge status={detail.status} />
        {detail.stage && <span className="text-sm text-slate-700">{detail.stage}</span>}
        {detail.status === "success" && detail.artifactName && (
          <a
            href={`/api/builds/${detail.id}/artifact`}
            download={detail.artifactName}
            className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Download {detail.artifactName}
          </a>
        )}
      </div>

      {detail.errorMessage && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{detail.errorMessage}</p>
      )}

      <pre
        ref={logRef}
        className="mt-4 h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-200"
      >
        {detail.log || "No output yet…"}
      </pre>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Phone access (shown by the desktop app)
// ---------------------------------------------------------------------------

function PhoneAccess() {
  const [info, setInfo] = useState<{ urls: string[]; pin: string | null; desktop: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/info", { cache: "no-store" })
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  }, []);
  if (!info || !info.desktop || info.urls.length === 0) return null;
  return (
    <Card title="Use it from your phone" subtitle="Install the Android app, then enter this address and PIN (same Wi-Fi).">
      <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm ring-1 ring-slate-200">
        {info.urls.map((u) => (
          <p key={u} className="font-mono text-slate-900">{u}</p>
        ))}
        {info.pin && (
          <p className="text-slate-600">
            PIN: <span className="font-mono font-semibold text-slate-900">{info.pin}</span>
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Page() {
  const [builds, setBuilds] = useState<BuildSummary[]>([]);
  const [tools, setTools] = useState<ToolStatus[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/builds", { cache: "no-store" });
      if (res.ok) setBuilds(await res.json());
    } catch {
      // Network blip — the next poll will retry.
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    fetch("/api/toolchain", { cache: "no-store" })
      .then((r) => r.json())
      .then(setTools)
      .catch(() => setTools([]));
  }, []);

  const handleCreated = (build: BuildSummary) => {
    setSelectedId(build.id);
    refresh();
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this build and its files?")) return;
    const res = await fetch(`/api/builds/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error ?? "Delete failed");
      return;
    }
    if (selectedId === id) setSelectedId(null);
    refresh();
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.08em] text-indigo-600">Zip → APK / EXE</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">APK & EXE Maker</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Drop in a zip of your app, and the server extracts it, installs what it needs, and builds an installable
          Android APK or a Windows EXE you can download.
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[400px_1fr]">
        <div className="space-y-6">
          <UploadCard onCreated={handleCreated} />
          <PhoneAccess />
          <ToolchainCard tools={tools} />
        </div>
        <div className="space-y-6">
          <BuildList builds={builds} selectedId={selectedId} onSelect={setSelectedId} onDelete={handleDelete} />
          {selectedId !== null && <BuildDetailPanel key={selectedId} id={selectedId} />}
        </div>
      </div>
    </main>
  );
}
