import { json } from "../_proxy";
export const dynamic = "force-dynamic";
export async function GET() { return json("/graph"); }
