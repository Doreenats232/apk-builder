// Copies the static files Next's standalone server needs, ready for electron-builder.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const sa = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(sa, "server.js"))) throw new Error("Run `npm run build` first");
fs.cpSync(path.join(root, ".next", "static"), path.join(sa, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(sa, "public"), { recursive: true });
console.log("standalone ready");
