import { NextRequest } from "next/server";
import { stream } from "../_proxy";
export const runtime = "nodejs"; export const maxDuration = 300; export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) { return stream("/stamp", req); }
