"use client";
import { useMemo } from "react";

/** The back room — the crew along the street, lighting up as the graph runs.
 *
 * Each face is a node in the learner's own edges list, so the row is drawn from the
 * graph the service reported: add `approve,` and Odo appears. The courier (your
 * familiar) walks the dotted street between them; nothing moves faster than the
 * workflow does.
 */

export type CrewState = "idle" | "live" | "done" | "waiting";

export default function BackRoom({ nodes, states, faces, names, roles, courier, night, morning }: {
  nodes: string[]; states: Record<string, CrewState>; faces: Record<string, string>;
  names: Record<string, string>; roles: Record<string, string>; courier: string;
  night: boolean; morning: boolean;
}) {
  const W = 640, H = 262, R = 44;
  const pos = useMemo(() => nodes.map((n, i) => ({
    n, x: nodes.length === 1 ? W / 2 : 74 + i * ((W - 148) / (nodes.length - 1)),
    y: i % 2 === 0 ? 58 : 138,
  })), [nodes]);
  const path = pos.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` :
    `C ${(pos[i - 1].x + p.x) / 2} ${pos[i - 1].y}, ${(pos[i - 1].x + p.x) / 2} ${p.y}, ${p.x} ${p.y}`)).join(" ");

  // Where the courier is: on the way to the node that is running, or waiting.
  const liveIdx = nodes.findIndex((n) => states[n] === "live" || states[n] === "waiting");
  const lastDone = nodes.reduce((acc, n, i) => (states[n] === "done" ? i : acc), -1);
  // Parked at the door before a run, between two faces while one is working, and
  // out past the last face once everything is done — never on top of a name.
  let cx = (pos[0]?.x ?? W / 2) - 78, cy = (pos[0]?.y ?? 100) + 76;
  if (liveIdx > 0) { cx = (pos[liveIdx - 1].x + pos[liveIdx].x) / 2; cy = Math.max(pos[liveIdx - 1].y, pos[liveIdx].y) + 46; }
  else if (liveIdx === 0) { cx = pos[0].x - 78; cy = pos[0].y + 76; }
  else if (lastDone >= 0 && lastDone === nodes.length - 1) {
    const last = pos[lastDone];
    if (lastDone % 2 === 0) { cx = last.x - 4; cy = last.y + 118; } else { cx = last.x + 74; cy = last.y + 12; }
  }
  else if (lastDone >= 0) { cx = (pos[lastDone].x + pos[lastDone + 1].x) / 2; cy = Math.max(pos[lastDone].y, pos[lastDone + 1].y) + 46; }

  return (
    <div style={{ position: "relative", width: W, height: H, margin: "0 auto", borderRadius: 18,
      overflow: "visible", transition: "filter .8s" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}
        style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
        <path d={path} fill="none" stroke={night ? "#6b6394" : "#b0a3cc"} strokeWidth="2.5"
          strokeDasharray="3 9" strokeLinecap="round" style={{ transition: "stroke .8s" }} />
      </svg>

      {pos.map(({ n, x, y }) => {
        const s = states[n] ?? "idle";
        const ring = s === "done" ? "var(--mint)" : s === "live" ? "var(--violet)"
          : s === "waiting" ? "var(--gold)" : night ? "rgba(120,110,160,.5)" : "rgba(176,143,224,.35)";
        return (
          <div key={n} style={{ position: "absolute", left: x, top: y - R, transform: "translateX(-50%)",
            width: 120, textAlign: "center", transition: "opacity .5s", opacity: s === "idle" ? .55 : 1 }}>
            <div style={{ width: R * 2, height: R * 2, borderRadius: "50%", margin: "0 auto", padding: 4,
              background: night ? "#2a2547" : "#fff", border: `3px solid ${ring}`, position: "relative",
              boxShadow: s === "waiting" ? "0 0 0 6px rgba(230,192,105,.22), 0 0 30px rgba(230,192,105,.55)"
                : s === "live" ? "0 0 0 6px rgba(138,107,255,.15)" : "0 6px 18px rgba(120,100,180,.15)",
              transition: "border-color .4s, box-shadow .4s, background .8s",
              animation: s === "live" ? "floaty 1.4s ease-in-out infinite" : "none" }}>
              <img src={faces[n]} alt={names[n] ?? n} width={R * 2 - 8} height={R * 2 - 8}
                style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block",
                  filter: s === "idle" ? "saturate(.25)" : "none", transition: "filter .5s" }} />
              {(s === "done" || s === "waiting") && (
                <span style={{ position: "absolute", right: -4, bottom: -2, width: 30, height: 30, borderRadius: "50%",
                  display: "grid", placeItems: "center", fontSize: s === "done" ? 14 : 15, fontWeight: 700,
                  background: s === "done" ? "var(--mint)" : "#fff", color: "#fff", border: "2px solid #fff",
                  boxShadow: "0 2px 8px rgba(120,100,180,.25)" }}>{s === "done" ? "✓" : "✋"}</span>
              )}
            </div>
            <div className="serif" style={{ fontSize: 14.5, fontWeight: 600, marginTop: 7,
              color: night ? "#efeaff" : "var(--ink)", transition: "color .8s" }}>{names[n] ?? n}</div>
            <div className="mono" style={{ fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase",
              color: s === "waiting" ? "var(--gold-deep)" : night ? "#b6acd6" : "var(--faint)",
              fontWeight: s === "waiting" ? 700 : 500 }}>
              {s === "waiting" ? "waiting for you" : roles[n] ?? n}
            </div>
          </div>
        );
      })}

      {/* the courier: your familiar, on the street with the parcel */}
      <div style={{ position: "absolute", left: cx, top: cy, transform: "translate(-50%,-50%)",
        transition: "left .9s cubic-bezier(.4,.9,.4,1), top .9s cubic-bezier(.4,.9,.4,1)",
        display: "flex", alignItems: "center", gap: 2, opacity: night ? .55 : 1 }}>
        <img src={courier} alt="the courier" width={52} height={52}
          style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", background: "#fff",
            border: "3px solid var(--gold)", boxShadow: "0 6px 16px rgba(185,138,46,.3)" }} />
        <span style={{ fontSize: 20, marginLeft: -8 }}>{night ? "💤" : "📦"}</span>
      </div>

      {(night || morning) && (
        <div aria-hidden style={{ position: "absolute", inset: -16, borderRadius: 22, pointerEvents: "none",
          background: night
            ? "radial-gradient(circle at 88% 12%, rgba(255,244,194,.35), transparent 22%), linear-gradient(180deg, rgba(30,26,58,.78), rgba(58,49,100,.72))"
            : "linear-gradient(180deg, rgba(251,211,194,.55), rgba(255,242,224,.2))",
          transition: "opacity .8s", animation: morning ? "riseIn .8s ease both" : "none" }}>
          {night && <span style={{ position: "absolute", right: 26, top: 14, fontSize: 26 }}>🌙</span>}
          {morning && <span style={{ position: "absolute", right: 26, top: 14, fontSize: 26 }}>☀️</span>}
        </div>
      )}
    </div>
  );
}
