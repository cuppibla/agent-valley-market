"use client";

/** The Monocle — what the session actually holds. Hidden until asked for.
 *
 * Left: every event, with the keys it wrote. Right: the state, in four drawers —
 * this conversation, this customer (`user:`), the shop (`app:`), the counter top
 * (`temp:`). The same keys adk web's State tab shows, because it is the same
 * session.
 */

export type MonocleEvent = { author: string; node: string; text: string; route?: string | null;
  delta: Record<string, unknown>; interrupt?: { message?: string } | null; answer?: boolean };

const DRAWERS: [string, string, (k: string) => boolean][] = [
  ["this conversation", "session", (k) => !k.includes(":")],
  ["this customer", "user:", (k) => k.startsWith("user:")],
  ["the shop", "app:", (k) => k.startsWith("app:")],
  ["the counter top", "temp:", (k) => k.startsWith("temp:")],
];

export default function Monocle({ open, onClose, events, state, store, sid }: {
  open: boolean; onClose: () => void; events: MonocleEvent[]; state: Record<string, unknown>;
  store: string; sid: string;
}) {
  const short = (v: unknown) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 64 ? s.slice(0, 62) + "…" : s;
  };
  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 560, zIndex: 40,
      transform: open ? "translateX(0)" : "translateX(105%)", transition: "transform .35s ease",
      background: "linear-gradient(180deg,#2a2540,#1f1b33)", color: "#e8e3f6",
      borderLeft: "1px solid rgba(150,120,220,.35)", boxShadow: "-16px 0 40px rgba(80,60,130,.35)",
      display: "flex", flexDirection: "column", padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".16em", color: "#cdbcf5" }}>
          ▸ THE MONOCLE
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="mono" style={{ fontSize: 10, padding: "3px 9px", borderRadius: 999,
            color: store.startsWith("Sqlite") ? "#9fe6c4" : "#f2cf86",
            border: `1px solid ${store.startsWith("Sqlite") ? "rgba(159,230,196,.5)" : "rgba(242,207,134,.5)"}` }}>
            {store || "…"}
          </span>
          <button onClick={onClose} className="mono" style={{ background: "none", border: "1px solid rgba(150,120,220,.35)",
            color: "#cdbcf5", borderRadius: 8, padding: "3px 9px", fontSize: 11 }}>close</button>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 10.5, color: "#8a7fb0", marginBottom: 12 }}>session {sid || "—"}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 14, flex: 1, minHeight: 0 }}>
        <div style={{ overflowY: "auto", minHeight: 0 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: ".14em", color: "#8a7fb0", marginBottom: 6 }}>EVENTS</div>
          {events.length === 0 && <div className="mono" style={{ fontSize: 11.5, color: "#8a7fb0" }}>nothing yet</div>}
          {events.map((e, i) => (
            <div key={i} className="mono" style={{ fontSize: 11.5, lineHeight: 1.5, padding: "3px 0",
              borderBottom: "1px solid rgba(150,120,220,.12)" }}>
              <span style={{ color: e.author === "user" ? "#f2cf86" : "#b6a9d8", display: "inline-block", minWidth: 62 }}>
                {e.author === "user" ? (e.answer ? "you ✓" : "you") : e.node}
              </span>
              <span style={{ color: e.interrupt ? "#f2cf86" : (e.text || "").startsWith("auditor ·") ? "#f2a0b4" : "#d9d0f0" }}>
                {e.interrupt ? `⏸ ${e.interrupt.message}` : short(e.text)}
              </span>
              {e.route && <span style={{ color: "#cdbcf5" }}> → {e.route}</span>}
              {Object.keys(e.delta || {}).length > 0 && (
                <div style={{ color: "#9fe6c4", fontSize: 10.5 }}>Δ {Object.keys(e.delta).join(", ")}</div>
              )}
            </div>
          ))}
        </div>
        <div style={{ overflowY: "auto", minHeight: 0 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: ".14em", color: "#8a7fb0", marginBottom: 6 }}>STATE</div>
          {DRAWERS.map(([title, tag, test]) => {
            const keys = Object.keys(state).filter(test);
            return (
              <div key={tag} style={{ borderRadius: 10, padding: "8px 10px", marginBottom: 8,
                background: "rgba(255,255,255,.05)", border: "1px solid rgba(150,120,220,.18)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="serif" style={{ fontSize: 13, color: "#efeaff" }}>{title}</span>
                  <span className="mono" style={{ fontSize: 10, color: "#8a7fb0" }}>{tag}</span>
                </div>
                {keys.length === 0
                  ? <div className="mono" style={{ fontSize: 10.5, color: "#5f568a", marginTop: 3 }}>
                      {tag === "temp:" ? "wiped when the turn ended" : "empty"}</div>
                  : keys.map((k) => (
                    <div key={k} className="mono" style={{ fontSize: 11, marginTop: 3, wordBreak: "break-all" }}>
                      <span style={{ color: "#f2cf86" }}>{k.replace(/^\w+:/, "")}</span>
                      <span style={{ color: "#8a7fb0" }}> = </span>
                      <span style={{ color: "#d9d0f0" }}>{short(state[k])}</span>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
