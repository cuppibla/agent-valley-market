"use client";
import { useCallback, useEffect, useState } from "react";

/** The back office — the other side of an interrupt.
 *
 * This page is the whole argument for `interrupt_id`. The customer's question was
 * answered on the channel it arrived on: they typed, the clerk read it, done. This
 * one is different. The run ended somewhere else, the question is sitting in a
 * session this page has never seen, and the answer is about to come back from a
 * different screen — so it has to say **which case** it is answering.
 *
 * Open it in a second tab. Better, open it on your phone.
 */

type Case = {
  session_id: string; user_id: string; interrupt_id: string; message: string;
  case: { name?: string; amount?: number; key?: string } | null; at?: number;
};

export default function BackOffice() {
  const [queue, setQueue] = useState<Case[] | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [store, setStore] = useState("");

  const refresh = useCallback(async () => {
    const r = await fetch("/api/w3/queue").then((x) => x.json()).catch(() => null);
    if (!r) { setQueue([]); return; }
    setQueue(r.queue ?? []); setStore(r.store ?? "");
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 2000); return () => clearInterval(t); }, [refresh]);

  async function answer(c: Case, ok: boolean) {
    if (busy) return;
    setBusy(c.session_id);
    // The id is the point. Without it this answer has no idea which of the shop's
    // stopped runs it belongs to.
    const res = await fetch("/api/w3/stamp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: c.session_id, interrupt_id: c.interrupt_id,
                             ok, note: (note[c.session_id] ?? "").trim() }),
    }).catch(() => null);
    // Drain it. The response IS the workflow running: the server streams as the
    // graph advances, so dropping the connection half way stops the refund half way.
    try { await res?.text(); } catch { /* the customer's screen will catch up either way */ }
    setDone((d) => [...d, `${ok ? "stamped" : "declined"} · ${c.case?.name ?? "a case"} · ${c.session_id.slice(0, 8)}`]);
    setNote((n) => ({ ...n, [c.session_id]: "" }));
    setBusy(null);
    setTimeout(refresh, 700);
  }

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <div className="eyebrow">03 · COORDINATE</div>
          <h1 className="serif" style={{ fontWeight: 500, fontSize: 30, margin: "4px 0 0" }}>The Back Office</h1>
        </div>
        <span className="mono" style={{ fontSize: 11, padding: "6px 12px", borderRadius: 999,
          border: "1px solid var(--line)", background: "rgba(255,255,255,.6)",
          color: store.startsWith("Sqlite") ? "#2f7d67" : "var(--gold-deep)" }}>
          {store || "…"}
        </span>
      </div>

      <div className="glass" style={{ display: "flex", gap: 16, alignItems: "center", padding: "14px 18px", marginBottom: 16 }}>
        <img src="/world/npc/odo-stamp.jpg" alt="Odo" width={72} height={72}
          style={{ width: 72, height: 72, borderRadius: 18, objectFit: "cover", border: "3px solid var(--gold)" }} />
        <div>
          <div className="serif" style={{ fontSize: 20, fontWeight: 600 }}>Odo</div>
          <div className="eyebrow" style={{ fontSize: 10, marginTop: 2 }}>THE MANAGER · THAT&apos;S YOU NOW</div>
          <div style={{ color: "var(--sub)", fontSize: 13.5, marginTop: 5 }}>
            Every case below is a run that has stopped somewhere in the shop, waiting on this desk.
          </div>
        </div>
      </div>

      {queue === null && <div className="mono" style={{ color: "var(--faint)", fontSize: 12 }}>looking…</div>}

      {queue?.length === 0 && (
        <div className="glass" style={{ padding: "28px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>🗒️</div>
          <div className="serif" style={{ fontSize: 17 }}>Nothing is waiting.</div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 6 }}>
            start a return in the shop, and it will appear here within two seconds
          </div>
        </div>
      )}

      {queue?.map((c) => (
        <div key={c.session_id} className="glass" style={{ padding: "16px 18px", marginBottom: 12,
          borderColor: "var(--gold)", animation: "riseIn .3s ease both" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div className="serif" style={{ fontSize: 18, fontWeight: 600 }}>{c.message}</div>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)" }}>
              order {c.case?.key ?? "—"}
            </span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--sub)", marginBottom: 10 }}>
            session <b style={{ color: "var(--ink)" }}>{c.session_id}</b>
            {"  ·  "}interrupt <b style={{ color: "var(--ink)" }}>{c.interrupt_id}</b>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input value={note[c.session_id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [c.session_id]: e.target.value }))}
              placeholder="if you decline — why? the customer will hear it"
              style={{ flex: 1, fontSize: 13, padding: "9px 12px", borderRadius: 10,
                border: "1px solid var(--line)", background: "#fffdf6", color: "var(--ink)" }} />
            <button onClick={() => answer(c, true)} disabled={!!busy}
              style={{ fontSize: 14.5, fontWeight: 600, padding: "11px 18px", borderRadius: 13, border: "none", color: "#fff",
                whiteSpace: "nowrap", background: "linear-gradient(180deg,#8ad6bd,#5fb99c)" }}>Stamp it ✓</button>
            <button onClick={() => answer(c, false)} disabled={!!busy}
              style={{ fontSize: 14.5, fontWeight: 600, padding: "11px 16px", borderRadius: 13, whiteSpace: "nowrap",
                border: "1.5px solid var(--rose)", color: "#b03e64", background: "#fff" }}>Decline ↩</button>
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <div className="mono" style={{ fontSize: 11, color: "var(--faint)", marginTop: 18, lineHeight: 1.8 }}>
          {done.slice(-5).map((d, i) => <div key={i}>✓ {d}</div>)}
        </div>
      )}
    </div>
  );
}
