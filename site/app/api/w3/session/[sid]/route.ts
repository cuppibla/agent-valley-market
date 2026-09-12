import { json } from "../../_proxy";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  return json(`/session/${encodeURIComponent(sid)}`);
}
