import { NextRequest } from "next/server";
import { json } from "../_proxy";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  return json("/weather", { method: "POST", headers: { "content-type": "application/json" },
    body: await req.text() });
}
