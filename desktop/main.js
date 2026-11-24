const { app, BrowserWindow, Menu, Tray, nativeImage, clipboard, shell } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const cfgPath = () => path.join(app.getPath("userData"), "config.json");
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgPath(), "utf8")); } catch { return {}; } };
const saveCfg = (c) => fs.writeFileSync(cfgPath(), JSON.stringify(c));

let win, tray, server, port, cfg, quitting = false;

function newPin() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(8), (b) => chars[b % chars.length]).join("");
}

function freePort(start) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(freePort(start + 1)));
    s.listen(start, "0.0.0.0", () => s.close(() => resolve(start)));
  });
}

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === "IPv4" && !i.internal) out.push("http://" + i.address + ":" + port);
  return out;
}

function waitUp() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 1500 }, (res) => { res.resume(); resolve(); });
      req.on("error", () => (Date.now() - t0 > 60000 ? reject(new Error("Server did not start")) : setTimeout(tick, 400)));
      req.on("timeout", () => req.destroy());
    };
    tick();
  });
}

async function startServer() {
  if (server) { server.kill(); server = null; }
  const dir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", ".next", "standalone");
  server = spawn(process.execPath, [path.join(dir, "server.js")], {
    cwd: dir,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: cfg.lan ? "0.0.0.0" : "127.0.0.1",
      BUILDER_PIN: cfg.pin,
      BUILDER_DESKTOP: "1",
      BUILDER_DATA_DIR: path.join(app.getPath("userData"), "data"),
    },
  });
  server.on("exit", () => { server = null; });
  await waitUp();
}

function openUI() {
  win.loadURL("http://127.0.0.1:" + port + "/?pin=" + cfg.pin);
}

function createWindow() {
  win = new BrowserWindow({ width: 1200, height: 820, minWidth: 800, minHeight: 560, backgroundColor: "#f8fafc", title: "APK & EXE Maker", autoHideMenuBar: true });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  // Downloads of finished builds go to the Downloads folder (Electron default prompts) — keep default.
  // Closing hides to the tray so running builds and phone access keep working.
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  openUI();
}

function refreshTray() {
  const urls = lanUrls();
  tray.setToolTip("APK & EXE Maker");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open", click: () => win.show() },
    { type: "separator" },
    { label: cfg.lan ? "Phone access: ON" : "Phone access: OFF (this PC only)", enabled: false },
    { label: cfg.lan ? "Turn phone access off" : "Turn phone access on", click: async () => { cfg.lan = !cfg.lan; saveCfg(cfg); await startServer(); openUI(); refreshTray(); } },
    ...(cfg.lan && urls[0] ? [{ label: "Copy phone address (" + urls[0] + ")", click: () => clipboard.writeText(urls[0]) }] : []),
    { label: "Copy PIN", click: () => clipboard.writeText(cfg.pin) },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => win && win.show());
app.on("before-quit", () => { quitting = true; if (server) server.kill(); });

app.whenReady().then(async () => {
  cfg = loadCfg();
  if (!cfg.pin) cfg.pin = newPin();
  if (cfg.lan === undefined) cfg.lan = true;
  saveCfg(cfg);
  port = await freePort(cfg.port || 4317);
  cfg.port = port; saveCfg(cfg);
  await startServer();
  createWindow();
  tray = new Tray(nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABBElEQVR4nO3XTyuEYRiF8etjKQtloSxmoWahLJSFxZSFsrCYslAW/jYxhkwmjWaIRCSS73XfNse9VuLlfWeexfMNfqvTuZh4NybfjKlXY/rFmHk2Zp+M2qMx92DU7435O2Ph1li8MZaujeUrozEwVi6N1b6zduGs95zmubPRdTbPnK1TZ7vj7B07rSOnfeictJzugdPbd/q7znDnAwoCFAAFQAFQABQABUABUAAUAJUNUAAUABUAKAAKgP4LUAkA/RWgEgEqClAFAP0WoAoB+gmgEQD0HUAjBCgDvgI0BoAyIAMyIAOSAox9ijMgiUOSxCVL4pQmccuTCJMk0iyJOK00zz8B2tIOIpP8engAAAAASUVORK5CYII="));
  tray.on("click", () => win.show());
  refreshTray();
});
