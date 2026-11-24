import { getToolchainStatus } from "@/lib/builder/toolchain";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getToolchainStatus());
}
