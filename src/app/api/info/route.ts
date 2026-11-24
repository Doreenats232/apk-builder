import os from "node:os";

export const dynamic = "force-dynamic";

// Addresses other devices on the same Wi-Fi can use to reach this builder (desktop app only).
export async function GET() {
  const port = process.env.PORT ?? "3000";
  const urls: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) urls.push(`http://${i.address}:${port}`);
    }
  }
  return Response.json({ urls, pin: process.env.BUILDER_PIN ?? null, desktop: Boolean(process.env.BUILDER_DESKTOP) });
}
