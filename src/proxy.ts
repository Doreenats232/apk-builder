import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// Access PIN. The desktop app sets BUILDER_PIN so that other devices on the network (e.g. your phone)
// need the PIN before they can upload projects — builds run code on this computer.
// Without BUILDER_PIN (local dev) everything is open.
const COOKIE = "builder_pin";
const g = globalThis as typeof globalThis & { __pinFails?: { n: number; reset: number } };

const sign = (pin: string) => createHmac("sha256", "apk-builder").update(pin).digest("hex");
function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function lockedOut(): boolean {
  const f = g.__pinFails;
  return Boolean(f && f.reset > Date.now() && f.n >= 30);
}
function recordFail() {
  const f = g.__pinFails;
  g.__pinFails = f && f.reset > Date.now() ? { n: f.n + 1, reset: f.reset } : { n: 1, reset: Date.now() + 300_000 };
}

const page = (msg: string) =>
  new NextResponse(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>APK &amp; EXE Maker</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0b1020;color:#e2e8f0}
form{width:min(340px,90vw);padding:28px;border-radius:20px;background:#121a30;border:1px solid #243052}
h1{margin:0 0 6px;font-size:20px}p{margin:0 0 14px;color:#94a3b8;font-size:14px}
input{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #243052;background:#0b1020;color:#fff;font-size:16px}
button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:12px;font-weight:700;color:#06101f;background:linear-gradient(90deg,#818cf8,#38bdf8)}
.e{color:#fca5a5;font-size:13px;margin-top:8px}</style>
<form method="get" action="/"><h1>APK &amp; EXE Maker</h1><p>Enter the access PIN shown in the desktop app.</p>
<input name="pin" autofocus autocomplete="off" placeholder="PIN"><button>Open</button><div class="e">${msg}</div></form>`,
    { status: 401, headers: { "content-type": "text/html; charset=utf-8" } },
  );

export function proxy(req: NextRequest) {
  const pin = process.env.BUILDER_PIN;
  if (!pin) return NextResponse.next();
  const expected = sign(pin);

  if (same(req.cookies.get(COOKIE)?.value ?? "", expected)) return NextResponse.next();
  if (same(req.headers.get("x-builder-pin") ?? "", pin)) return NextResponse.next();

  const given = req.nextUrl.searchParams.get("pin");
  if (given !== null) {
    if (lockedOut()) return page("Too many wrong attempts. Try again in a few minutes.");
    if (same(given, pin)) {
      const url = req.nextUrl.clone();
      url.searchParams.delete("pin");
      const res = NextResponse.redirect(url);
      res.cookies.set({ name: COOKIE, value: expected, httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86400 });
      return res;
    }
    recordFail();
    return page("Wrong PIN.");
  }

  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "PIN required" }, { status: 401 });
  return page("");
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
