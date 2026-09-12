// One proxy for every door in the street service. Streams pass straight through:
// a crew card that lights up only after the whole workflow returns teaches nothing.
import { NextRequest } from "next/server";

export const AGENT_URL = process.env.VALLEY_AGENT_URL || "http://127.0.0.1:8300";

const DOWN = (msg: string) =>
  new Response(`data: ${JSON.stringify({ kind: "down", message: msg })}\n\n`,
    { headers: { "content-type": "text/event-stream" } });

export async function stream(path: string, req: NextRequest) {
  const body = await req.text();
  try {
    const upstream = await fetch(`${AGENT_URL}${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
      // @ts-expect-error — node fetch needs this to stream, the DOM types do not have it
      duplex: "half", signal: AbortSignal.timeout(295000),
    });
    if (!upstream.ok || !upstream.body) return DOWN("the street answered " + upstream.status);
    return new Response(upstream.body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no", "x-session-id": upstream.headers.get("x-session-id") ?? "" },
    });
  } catch {
    return DOWN("the street is closed");
  }
}

export async function json(path: string, init?: RequestInit) {
  try {
    const r = await fetch(`${AGENT_URL}${path}`, { ...init, cache: "no-store",
      signal: AbortSignal.timeout(8000) });
    return new Response(await r.text(), { status: r.status,
      headers: { "content-type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ down: true }), { status: 503,
      headers: { "content-type": "application/json" } });
  }
}
