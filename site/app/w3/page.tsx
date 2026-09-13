"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BackRoom, { type CrewState } from "@/components/BackRoom";
import FamiliarPicker from "@/components/FamiliarPicker";
import Monocle, { type MonocleEvent } from "@/components/Monocle";
import SaveChip from "@/components/SaveChip";
import { getSave, updateSave, type SaveFile } from "@/lib/save";

/** Market Street — one counter, two sides.
 *
 * Left, you are the customer and you talk to Twill. Right, the back room: the crew
 * light up as the workflow runs, and when the graph stops to ask a person, Odo
 * raises a hand and the stamp is yours to give. The customer never sees the
 * workflow. The staff never see the chat. Same session.
 */

// The crew along the street, per path — drawn from the graph the service reports,
// so a node that is not in your edges list (`approve`, before chapter 4) is simply
// not there.
const PATHS: Record<string, string[]> = {
  buy: ["desk", "reserve", "dispatch", "charge", "grant"],
  pick: ["desk", "clerk"],
  return: ["desk", "verify", "approve", "refund"],
  ask: ["desk", "twill"],
};
const FACE: Record<string, string> = {
  desk: "/world/npc/twill.jpg", twill: "/world/npc/twill.jpg",
  clerk: "/world/npc/vesper.jpg", refund: "/world/npc/vesper.jpg",
  charge: "/world/npc/maren.jpg", verify: "/world/npc/maren.jpg",
  reserve: "/world/npc/nix.jpg", grant: "/world/npc/nix.jpg",
  approve: "/world/npc/odo-stamp.jpg",
};
const NAME: Record<string, string> = { desk: "Twill", twill: "Twill", clerk: "Vesper", refund: "Vesper",
  charge: "Maren", verify: "Maren", reserve: "Nix", grant: "Nix", approve: "Odo", dispatch: "you" };
const ROLE: Record<string, string> = { desk: "desk", twill: "answers", clerk: "asks you", reserve: "reserve",
  dispatch: "courier", charge: "charge", grant: "grant", verify: "verify", approve: "manager", refund: "refund" };

type Item = { id: string; name: string; price: number; blurb: string; icon: string };
type Bubble = { who: "me" | "twill" | "sys"; text: string; k: number };
type Waiting = { id: string; message: string; payload?: Record<string, unknown> | null } | null;

const SID_KEY = "a101.w3.sid";
const newKey = () => "#" + Math.random().toString(36).slice(2, 6);
const newSid = () => "c-" + Math.random().toString(36).slice(2, 10);

export default function MarketStreet() {
  const [save, setSave] = useState<SaveFile | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [nodes, setNodes] = useState<string[]>([]);          // every node in the learner's graph
  const [path, setPath] = useState<string>("buy");
  const [states, setStates] = useState<Record<string, CrewState>>({});
  const [chat, setChat] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, _setWaiting] = useState<Waiting>(null);
  const waitingRef = useRef<Waiting>(null);
  const setWaiting = (w: Waiting) => { waitingRef.current = w; _setWaiting(w); };
  // The other thing a run can be holding. Not a question — nobody was asked
  // anything — just a parcel that is still out.
  const [parcel, _setParcel] = useState<{ order?: string } | null>(null);
  const parcelRef = useRef<{ order?: string } | null>(null);
  const setParcel = (p: { order?: string } | null) => { parcelRef.current = p; _setParcel(p); };
  const [shelf, setShelf] = useState<Record<string, number>>({});
  const [receipt, setReceipt] = useState<{ t: string; tone?: string }[]>([]);
  const [purse, setPurse] = useState<number | null>(null);
  const [rain, setRain] = useState(false);
  const [faint, setFaint] = useState(false);
  const [down, _setDown] = useState(false);
  const downRef = useRef(false);
  const setDown = (v: boolean) => { downRef.current = v; _setDown(v); };
  const [morning, setMorning] = useState(false);
  const [monocle, setMonocle] = useState(false);
  const [events, setEvents] = useState<MonocleEvent[]>([]);
  const [snap, setSnap] = useState<Record<string, unknown>>({});
  const [store, setStore] = useState("");
  const [graphErr, setGraphErr] = useState<string | null>(null);
  const sid = useRef("");
  const pending = useRef<{ text: string } | null>(null);   // a delivery the courier has not heard back on
  const k = useRef(0);
  const chatBox = useRef<HTMLDivElement>(null);

  const say = (who: Bubble["who"], t: string) => setChat((c) => [...c, { who, text: t, k: k.current++ }]);
  const line = (t: string, tone?: string) => setReceipt((r) => [...r.slice(-7), { t, tone }]);

  // ── who is here ──────────────────────────────────────────────────────────
  useEffect(() => {
    setSave(getSave());
    const refresh = () => setSave(getSave());
    window.addEventListener("a101-save", refresh);
    return () => window.removeEventListener("a101-save", refresh);
  }, []);
  useEffect(() => { const id = requestAnimationFrame(() => { const el = chatBox.current; if (el) el.scrollTop = el.scrollHeight; }); return () => cancelAnimationFrame(id); }, [chat, waiting, busy]);

  // While the back office is holding a question, the answer arrives on a different
  // screen — so this one has to look.
  useEffect(() => {
    if (!waiting || down) return;
    const t = setInterval(() => { if (!busyRef.current) restoreRef.current?.(true); }, 2500);
    return () => clearInterval(t);
  }, [waiting, down]);

  const loadGraph = useCallback(async () => {
    const r = await fetch("/api/w3/graph").then((x) => x.json()).catch(() => null);
    if (!r?.graph) { setGraphErr("the street isn't running — bash valley.sh"); return null; }
    setGraphErr(r.graph_error ?? null);
    setNodes(r.graph.nodes);
    return r.graph.nodes as string[];
  }, []);

  // Rebuild everything from the session itself. After a reload, or after the shop
  // reopens, this is the only memory the browser trusts — and what it finds there
  // depends entirely on where the service kept it.
  const restore = useCallback(async (silent = false) => {
    if (!sid.current) return;
    const s = await fetch(`/api/w3/session/${sid.current}`).then((x) => x.json()).catch(() => null);
    if (!s) return;
    setStore(s.store ?? "");
    if (!s.exists) {
      setEvents([]); setSnap({});
      if (!silent) { setWaiting(null); setStates({}); }
      return;
    }
    setEvents(s.events); setSnap(s.state);
    if (typeof s.state["user:sparks"] === "number") { setPurse(s.state["user:sparks"]); updateSave({ sparks: s.state["user:sparks"] }); }
    setWaiting(s.waiting ? { id: s.waiting.id, message: s.waiting.message, payload: s.waiting.payload } : null);
    setParcel(s.parcel ? { order: s.parcel.order } : null);
    if (s.state?.["app:stock"]) setShelf(s.state["app:stock"]);
    // the chat, the receipt and the crew, from the events
    const bubbles: Bubble[] = []; const slip: { t: string; tone?: string }[] = [];
    let lastPath = "buy"; const st: Record<string, CrewState> = {};
    for (const e of s.events as (MonocleEvent & { interrupt?: { node: string; message: string } })[]) {
      if (e.author === "user" && e.text) { bubbles.push({ who: "me", text: e.text, k: k.current++ }); Object.keys(st).forEach((n) => delete st[n]); }
      else if (["reply", "twill", "clerk"].includes(e.node) && e.text) bubbles.push({ who: "twill", text: e.text, k: k.current++ });
      else if (e.interrupt) { bubbles.push({ who: "twill", text: "This one needs the manager's stamp — one moment.", k: k.current++ }); st[e.node] = "waiting"; }
      if (e.route && PATHS[e.route]) lastPath = e.route;
      if (e.node && e.node !== "route" && !e.interrupt) st[e.node] = "done";
      if (e.node) lastNode.current = e.node;
      if (e.node === "charge" && e.text.includes("seen")) slip.push({ t: e.text, tone: "ok" });
      if (e.node === "verify" && e.text?.includes("nothing")) slip.push({ t: e.text, tone: "dim" });
    }
    if (lastNode.current === "clerk" && !s.waiting && !s.parcel) st["clerk"] = "waiting";
    if (s.parcel) st["dispatch"] = "waiting";
    setChat(bubbles); setReceipt(slip.slice(-8)); setPath(lastPath); setStates(st);
  }, []);

  const restoreRef = useRef<((silent?: boolean) => Promise<void>) | null>(null);
  useEffect(() => { restoreRef.current = restore; }, [restore]);

  useEffect(() => {
    sid.current = localStorage.getItem(SID_KEY) || "";
    if (!sid.current) { sid.current = newSid(); localStorage.setItem(SID_KEY, sid.current); }
    fetch("/api/w3/items").then((r) => r.json()).then((d) => setItems(d.items ?? [])).catch(() => {});
    fetch("/api/w3/health").then((r) => r.json()).then((d) => { if (d?.faint) setFaint(true); if (d?.store) setStore(d.store); }).catch(() => {});
    loadGraph().then(() => restore());
  }, [loadGraph, restore]);

  // ── the night watch ──────────────────────────────────────────────────────
  // The service is gone. Nothing to do but wait for the shop to reopen — and then
  // ask the session what it remembers.
  const nightWatch = useCallback(() => {
    setDown(true); setBusy(false); busyRef.current = false;
    const timer = setInterval(async () => {
      const ok = await fetch("/api/w3/health").then((r) => r.ok).catch(() => false);
      if (!ok) return;
      clearInterval(timer);
      setDown(false); setMorning(true); setFaint(false);
      setTimeout(() => setMorning(false), 3200);
      await loadGraph();
      await restore();
      const s = await fetch(`/api/w3/session/${sid.current}`).then((x) => x.json()).catch(() => null);
      line("☀️ the shop reopened · " + (s?.exists ? "same ledger" : "the ledger is gone"), s?.exists ? "ok" : "bad");
      say("sys", s?.exists ? "☀️ Morning. Twill still has your ledger." : "☀️ Morning. Twill has no idea who you are.");
      if (pending.current) {
        // No ack ever came, so the courier does what couriers do.
        const again = pending.current.text;
        setTimeout(() => { say("sys", "📦 the courier tries the same delivery again"); send(again, true); }, 1400);
      }
    }, 1500);
  }, [loadGraph, restore]);        // eslint-disable-line react-hooks/exhaustive-deps

  // ── one stream reader for both doors ─────────────────────────────────────
  async function consume(res: Response): Promise<"ok" | "down" | "waiting"> {
    const reader = res.body?.getReader();
    if (!reader) return "down";
    const dec = new TextDecoder(); let buf = ""; let closed = false; let paused = false; let fainted = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split("\n\n"); buf = chunks.pop() ?? "";
        for (const c of chunks) {
          if (!c.startsWith("data: ")) continue;
          const d = JSON.parse(c.slice(6));
          if (d.kind === "graph") { setNodes(d.graph.nodes); setGraphErr(d.graph_error ?? null); setStore(d.store ?? ""); }
          else if (d.kind === "node") {
            if (d.node === "route" && d.route) { setPath(PATHS[d.route] ? d.route : "ask"); setStates({ desk: "done", [PATHS[d.route]?.[1] ?? "twill"]: "live" }); }
            else if (d.node === "clerk") { /* the clerk's own turn — handled below */ }
            else {
              setStates((s) => {
                const next: Record<string, CrewState> = { ...s, [d.node]: "done" };
                const p = PATHS[pathRef.current]; const i = p?.indexOf(d.node) ?? -1;
                if (i >= 0) { for (let j = i + 1; j < p.length; j++) if (nodesRef.current.includes(p[j])) { next[p[j]] = "live"; break; } }
                return next;
              });
            }
            if (d.node === "desk") setStates((s) => ({ ...s, desk: "done" }));
            // The purse moves the moment a node writes it — not at the end of the run.
            // A clerk who faints after `charge` has still charged you.
            if (typeof d.delta?.["user:sparks"] === "number") { setPurse(d.delta["user:sparks"]); updateSave({ sparks: d.delta["user:sparks"] }); }
            if (Array.isArray(d.delta?.["user:inventory"])) updateSave({ inventory: d.delta["user:inventory"] });
            if (d.node === "charge" && d.text.includes("seen")) line(d.text, "ok");
            if (d.node === "verify" && d.text.includes("nothing")) line(d.text, "dim");
            if (["reply", "twill", "clerk"].includes(d.node) && d.text) say("twill", d.text);
            // A rule the shop keeps, refusing a write — see street/auditor.py.
            if (d.text.startsWith("auditor ·")) {
              setStates((st) => ({ ...st, [d.node]: "refused" as CrewState }));
              say("sys", "🛡 " + d.text);
            }
            if (d.node) lastNode.current = d.node;
            setEvents((e) => [...e, { author: "street", node: d.node, text: d.text, route: d.route, delta: d.delta }]);
          } else if (d.kind === "interrupt") {
            paused = true;
            setWaiting({ id: d.interrupt_id, message: d.message, payload: d.payload });
            setStates((s) => ({ ...s, [d.node]: "waiting" }));
            say("twill", "This one needs the manager's stamp — one moment.");
            setEvents((e) => [...e, { author: "street", node: d.node, text: "", delta: {}, interrupt: { message: d.message } }]);
          } else if (d.kind === "faint") {
            fainted = true;
          } else if (d.kind === "state") {
            closed = true;
            setSnap(d.state);
            if (typeof d.state["user:sparks"] === "number") { setPurse(d.state["user:sparks"]); updateSave({ sparks: d.state["user:sparks"] }); }
            if (Array.isArray(d.state["user:inventory"])) updateSave({ inventory: d.state["user:inventory"] });
            setStates((s) => Object.fromEntries(Object.entries(s).map(([n, v]) => [n, v === "live" ? "idle" : v])) as Record<string, CrewState>);
            if (!d.waiting) setWaiting(null);
            setParcel(d.parcel ? { order: d.parcel.order } : null);
            if (d.state["app:stock"]) setShelf(d.state["app:stock"]);
            if (d.parcel) setStates((s) => ({ ...s, dispatch: "waiting" }));
            if (lastNode.current === "clerk" && !d.waiting && !d.parcel) {
              setStates((s) => ({ ...s, clerk: "waiting" }));
            }
          } else if (d.kind === "down") { say("sys", d.message); return "down"; }
          else if (d.kind === "error") { say("sys", d.message); }
        }
      }
    } catch { /* the connection dropped — handled below */ }
    if (fainted || !closed) return "down";
    return paused ? "waiting" : "ok";
  }
  const pathRef = useRef(path); useEffect(() => { pathRef.current = path; }, [path]);
  const nodesRef = useRef(nodes); useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  async function send(t: string, retry = false) {
    const msg = t.trim();
    if (!msg || busyRef.current || downRef.current) return;
    setBusy(true); busyRef.current = true; setText("");
    if (!retry) say("me", msg);
    setStates({ desk: "live" });
    const isBuy = /^buy\b/i.test(msg);
    if (isBuy) pending.current = { text: msg };
    const res = await fetch("/api/w3/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sid.current, text: msg, purse: getSave()?.sparks ?? 30 }),
    }).catch(() => null);
    const outcome = res ? await consume(res) : "down";
    setBusy(false); busyRef.current = false;
    if (outcome === "down") { nightWatch(); return; }
    if (isBuy) {
      pending.current = null;
      const s = getSave(); if (s && !s.stamps[2]) updateSave({ stamps: s.stamps.map((v, i) => (i === 2 ? true : v)) });
      // ☔ The ack got lost. The courier knocks again with the same parcel — same
      // order number — because that is what at-least-once delivery means.
      if (rainRef.current && !retry) {
        setTimeout(() => { say("sys", "☔ the ack was lost — the courier knocks again, same parcel"); send(msg, true); }, 1200);
      }
    }
  }
  const busyRef = useRef(false);
  const rainRef = useRef(rain); useEffect(() => { rainRef.current = rain; }, [rain]);
  // Which node the run stopped on. If it stopped ON the clerk, the clerk is holding
  // the workflow open waiting for an answer — one node lit, everything after it dark.
  const lastNode = useRef<string>("");

  // The courier reports back. Nobody is answering a question here — the world is
  // simply saying the parcel arrived, on the ticket it was given.
  async function deliver() {
    if (busyRef.current || downRef.current || !parcelRef.current) return;
    setBusy(true); busyRef.current = true;
    say("sys", "🔔 the courier knocks");
    setStates((s) => ({ ...s, dispatch: "done", charge: "live" }));
    const res = await fetch("/api/w3/delivered", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sid.current }) }).catch(() => null);
    const outcome = res ? await consume(res) : "down";
    setBusy(false); busyRef.current = false;
    if (outcome === "down") nightWatch();
  }

  async function armFaint() {
    if (downRef.current) return;
    // Someone is waiting on a question: faint right now, card still up.
    if (waitingRef.current) {
      say("sys", "💥 the clerk fainted — with Odo's question still on the desk");
      await fetch("/api/w3/weather", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ faint: false, now: true }) }).catch(() => {});
      setTimeout(() => nightWatch(), 600);
      return;
    }
    const next = !faint;
    setFaint(next);
    await fetch("/api/w3/weather", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ faint: next }) }).catch(() => {});
    say("sys", next ? "💥 armed — the clerk will faint on the next sale" : "💥 disarmed");
  }

  function fresh() {
    sid.current = newSid(); localStorage.setItem(SID_KEY, sid.current);
    setChat([]); setReceipt([]); setStates({}); setWaiting(null); setEvents([]); setSnap({}); pending.current = null;
    say("sys", "a new conversation — same customer, same purse");
  }

  // ── the picture ──────────────────────────────────────────────────────────
  if (save === undefined) return null;
  if (!save?.name) return <FamiliarPicker onDone={() => setSave(getSave())} />;

  const crew = (PATHS[path] ?? PATHS.buy).filter((n) => nodes.includes(n) || n === "notify" && nodes.includes("notify"));
  // The courier is the learner's own familiar, so `dispatch` wears their face.
  const faces = { ...FACE, dispatch: save.portrait || "/world/icons/species/cat.jpg" };
  const status = down ? "closed for the night" : waiting ? "waiting for the back room"
    : parcel ? "waiting for the courier" : busy ? "checking the ledger" : "at the counter";
  const dot = down ? "#6b6394" : waiting || parcel ? "var(--gold)" : busy ? "var(--violet)" : "var(--mint)";
  const stallOpen = !busy && !down && !waiting && !parcel;
  const orders = (snap["orders"] ?? {}) as Record<string, { name: string; price: number; status: string; charged?: boolean }>;

  return (
    <div className="wrap" style={{ paddingBottom: 30 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14, gap: 16 }}>
        <div>
          <div className="eyebrow">03 · COORDINATE</div>
          <h1 className="serif" style={{ fontWeight: 500, fontSize: 30, margin: "4px 0 0" }}>Market Street</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {graphErr && <span className="mono" style={{ fontSize: 11, color: "var(--gold-deep)",
            background: "rgba(230,192,105,.18)", padding: "6px 12px", borderRadius: 10 }}>{graphErr}</span>}
          <Link href="/" className="mono" style={{ fontSize: 11.5, padding: "7px 12px", borderRadius: 999,
            border: "1px solid var(--line)", background: "rgba(255,255,255,.55)", color: "var(--violet)" }}>map</Link>
          <SaveChip />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "460px 1fr", gap: 18, minHeight: 690, alignItems: "stretch" }}>
        {/* ── the counter ─────────────────────────────────────────────── */}
        <section className="glass" style={{ display: "flex", flexDirection: "column", padding: "20px 20px 16px" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
            <img src="/world/npc/twill.jpg" alt="Twill" width={88} height={88}
              style={{ width: 88, height: 88, borderRadius: 22, objectFit: "cover", border: "3px solid var(--gold)",
                boxShadow: "0 6px 18px rgba(185,138,46,.25)", filter: down ? "saturate(.3) brightness(.8)" : "none", transition: "filter .8s" }} />
            <div>
              <div className="serif" style={{ fontSize: 22, fontWeight: 600 }}>Twill</div>
              <div className="eyebrow" style={{ fontSize: 10, marginTop: 2 }}>the Shopkeep</div>
              <div className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, padding: "5px 11px",
                borderRadius: 999, background: "#fff", border: "1px solid var(--line)", color: "var(--sub)", marginTop: 8 }}>
                <i style={{ width: 8, height: 8, borderRadius: "50%", background: dot, boxShadow: `0 0 0 3px ${dot}33`, display: "inline-block" }} />
                {status}
              </div>
            </div>
          </div>

          <div ref={chatBox} style={{ flex: 1, minHeight: 240, maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "16px 2px 8px" }}>
            {chat.length === 0 && (
              <div className="b tw" style={bubble("twill")}>Welcome to Market Street. Everything&apos;s for sale — nothing may be sold twice.</div>
            )}
            {chat.map((b) => b.who === "sys"
              ? <div key={b.k} className="mono" style={{ alignSelf: "center", fontSize: 11, color: "var(--faint)", padding: "2px 8px", textAlign: "center" }}>{b.text}</div>
              : <div key={b.k} style={bubble(b.who)}>{b.text}</div>)}
            {busy && !waiting && (
              <div className="mono" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, color: "var(--gold-deep)", padding: "4px 4px" }}>
                <Dots /> Twill is checking the ledger
              </div>
            )}
            {waiting && !busy && (
              <div className="mono" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, color: "var(--gold-deep)", padding: "4px 4px" }}>
                <Dots /> Twill is waiting for the back room
              </div>
            )}
          </div>

          {/* the stall */}
          <div style={{ display: "flex", gap: 8, padding: "8px 0 10px", flexWrap: "wrap" }}>
            {items.map((it) => (
              <button key={it.id} disabled={!stallOpen || shelf[it.id] === 0}
                onClick={() => send(`buy the ${it.name} · order ${newKey()}`)}
                title={it.blurb} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 6px", borderRadius: 14,
                  border: "1px solid var(--line)", background: "#fff", opacity: stallOpen ? 1 : .5, cursor: stallOpen ? "pointer" : "default" }}>
                <img src={it.icon} alt="" width={30} height={30} style={{ width: 30, height: 30, borderRadius: 9, objectFit: "cover" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{it.name}</span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--gold-deep)" }}>✦{it.price}</span>
                <span className="mono" style={{ fontSize: 10.5, color: shelf[it.id] === 0 ? "var(--rose)" : "var(--faint)" }}>
                  {shelf[it.id] === 0 ? "sold out" : shelf[it.id] != null ? `${shelf[it.id]} left` : ""}</span>
              </button>
            ))}
            <button className="rune" disabled={!stallOpen} onClick={() => send("I'd like to return my last order")}
              style={{ opacity: stallOpen ? 1 : .5 }}>return it</button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 10px", borderRadius: 18, background: "#fff", border: "1px solid var(--line)" }}>
            <img src={save.portrait} alt={save.name} width={42} height={42} style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--gold)" }} />
            <input value={text} disabled={busy || down} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(text); }}
              placeholder={down ? "the shop is closed…" : "Talk to Twill…"}
              style={{ flex: 1, border: "none", outline: "none", fontSize: 14.5, background: "transparent", color: "var(--ink)" }} />
            <button onClick={() => send(text)} disabled={busy || down || !text.trim()}
              style={{ width: 38, height: 38, borderRadius: "50%", border: "none", color: "#fff", fontSize: 17,
                background: "linear-gradient(180deg,var(--violet-soft),var(--violet))", opacity: busy || down || !text.trim() ? .45 : 1 }}>↑</button>
          </div>
          <button onClick={fresh} className="mono" style={{ alignSelf: "center", marginTop: 8, fontSize: 10.5, color: "var(--faint)", background: "none", border: "none" }}>
            start a new conversation
          </button>
        </section>

        {/* ── the back room ───────────────────────────────────────────── */}
        <section className="glass" style={{ display: "flex", flexDirection: "column", padding: "18px 22px 18px", position: "relative", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".16em", color: "var(--faint)", textTransform: "uppercase" }}>
              The back room{down ? " · night" : morning ? " · morning" : ""}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Icon on={rain} title="the courier is unreliable today — every parcel is delivered twice" onClick={() => setRain((r) => !r)}>☔</Icon>
              <Icon on={faint} hot title={waiting ? "the clerk faints right now, question and all" : "the clerk faints on the next sale — the service exits mid-run"} onClick={armFaint}>💥</Icon>
              <Icon on={monocle} title="the Monocle — what the session holds" onClick={() => setMonocle((m) => !m)}>🧐</Icon>
            </div>
          </div>

          <div style={{ margin: "14px 0 6px" }}>
            <BackRoom nodes={crew} states={states} faces={faces} names={NAME} roles={ROLE}
              courier={save.portrait || "/world/icons/species/cat.jpg"} night={down} morning={morning} />
          </div>

          {parcel && !down && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 18px", borderRadius: 20, background: "#fff",
              border: "1.5px solid var(--gold)", boxShadow: "0 12px 34px rgba(230,192,105,.25)", animation: "riseIn .35s ease both" }}>
              <img src={save.portrait || "/world/icons/species/cat.jpg"} alt="the courier" width={66} height={66}
                style={{ width: 66, height: 66, borderRadius: 16, objectFit: "cover", border: "3px solid var(--gold)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="serif" style={{ fontSize: 18, fontWeight: 600 }}>Order {parcel.order} is out for delivery</div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 3 }}>
                  the run has ended · nobody was asked anything · nothing is charged until it arrives
                </div>
              </div>
              <button onClick={deliver} disabled={busy} style={btn("ok")}>🔔 the courier knocks</button>
            </div>
          )}

          {waiting && !down && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 18px", borderRadius: 20, background: "#fff",
              border: "1.5px solid var(--gold)", boxShadow: "0 12px 34px rgba(230,192,105,.25)", animation: "riseIn .35s ease both" }}>
              <img src="/world/npc/odo-stamp.jpg" alt="Odo" width={66} height={66}
                style={{ width: 66, height: 66, borderRadius: 16, objectFit: "cover", border: "3px solid var(--gold)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="serif" style={{ fontSize: 18, fontWeight: 600 }}>{waiting.message}</div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 3 }}>
                  this one is not yours to answer · it is waiting in <b>the back office</b>
                </div>
              </div>
              <a href="/w3/back" target="_blank" rel="noreferrer" style={{ ...btn("ok"), textDecoration: "none" }}>open the back office ↗</a>
            </div>
          )}

          <div style={{ display: "flex", gap: 14, marginTop: 14, alignItems: "stretch" }}>
            <div style={{ flex: 1, background: "#fffdf8", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", position: "relative", minHeight: 96 }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--gold-deep)", marginBottom: 6 }}>
                the ledger · {store ? (store.startsWith("Sqlite") ? "market.db" : "in memory") : "…"}
              </div>
              {/* Rendered straight from `orders` in state — the status column is where
                  every pause in this shop has its name. */}
              {Object.keys(orders).length === 0 && (
                <div className="mono" style={{ fontSize: 12, color: "var(--faint)" }}>nothing ordered yet</div>
              )}
              {Object.entries(orders).map(([key, o]) => {
                const tone = o.status === "paid" ? "#2f7d67" : o.status === "out_for_delivery" ? "var(--gold-deep)"
                  : o.status === "refunded" ? "var(--violet)" : "var(--sub)";
                return (
                  <div key={key} className="mono" style={{ display: "grid", gridTemplateColumns: "62px 1fr 34px 128px",
                    gap: 8, fontSize: 12, lineHeight: 1.9, alignItems: "baseline" }}>
                    <span style={{ color: "var(--faint)" }}>{key}</span>
                    <span style={{ color: "var(--sub)" }}>{o.name}</span>
                    <span style={{ color: "var(--gold-deep)" }}>✦{o.price}</span>
                    <span style={{ color: tone, fontWeight: 600 }}>
                      {o.status === "out_for_delivery" ? "out for delivery" : o.status}
                      {o.status === "paid" && o.charged ? " ✓" : ""}
                    </span>
                  </div>
                );
              })}
              {receipt.slice(-2).map((r, i) => (
                <div key={"n" + i} className="mono" style={{ fontSize: 11.5, lineHeight: 1.8, marginTop: 3,
                  color: r.tone === "ok" ? "#2f7d67" : r.tone === "bad" ? "#b03e64" : "var(--faint)" }}>{r.t}</div>
              ))}
              <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: 8,
                background: "repeating-linear-gradient(90deg,#fffdf8 0 10px,transparent 10px 16px)" }} />
            </div>
            <div style={{ width: 140, borderRadius: 12, background: "#fff", border: "1px solid var(--line)", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 2 }}>
              <span className="mono" style={{ fontSize: 30, color: "var(--gold-deep)" }}>✦ {purse ?? save.sparks}</span>
              <span className="mono" style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--faint)" }}>your purse</span>
            </div>
          </div>
        </section>
      </div>

      <Monocle open={monocle} onClose={() => setMonocle(false)} events={events} state={snap} store={store} sid={sid.current} />
    </div>
  );
}

function bubble(who: "me" | "twill"): React.CSSProperties {
  return who === "me"
    ? { alignSelf: "flex-end", maxWidth: "86%", padding: "11px 14px", borderRadius: 18, borderBottomRightRadius: 6, fontSize: 14.5, lineHeight: 1.4,
        color: "#fff", background: "linear-gradient(180deg,var(--violet-soft),var(--violet))", animation: "riseIn .25s ease both" }
    : { alignSelf: "flex-start", maxWidth: "88%", padding: "11px 14px", borderRadius: 18, borderBottomLeftRadius: 6, fontSize: 14.5, lineHeight: 1.4,
        color: "var(--ink)", background: "#fff", border: "1px solid var(--line)", animation: "riseIn .25s ease both" };
}
function btn(kind: "ok" | "no"): React.CSSProperties {
  return kind === "ok"
    ? { fontSize: 14.5, fontWeight: 600, padding: "12px 20px", borderRadius: 14, border: "none", color: "#fff", whiteSpace: "nowrap",
        background: "linear-gradient(180deg,#8ad6bd,#5fb99c)", boxShadow: "0 6px 16px rgba(111,199,173,.35)" }
    : { fontSize: 14.5, fontWeight: 600, padding: "12px 18px", borderRadius: 14, border: "1.5px solid var(--rose)", color: "#b03e64", background: "#fff", whiteSpace: "nowrap" };
}
function Icon({ children, on, hot, title, onClick }: { children: React.ReactNode; on: boolean; hot?: boolean; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} style={{ width: 38, height: 38, borderRadius: "50%", background: on ? (hot ? "#fff1f5" : "#fffdf6") : "#fff",
      border: `1px solid ${on ? (hot ? "var(--rose)" : "var(--gold)") : "var(--line)"}`, display: "grid", placeItems: "center", fontSize: 17,
      boxShadow: on ? `0 0 0 3px ${hot ? "rgba(229,138,168,.25)" : "rgba(230,192,105,.25)"}` : "none", transition: "all .2s" }}>{children}</button>
  );
}
function Dots() {
  return <span style={{ display: "inline-flex", gap: 3 }}>{[.4, .7, 1].map((o, i) => (
    <i key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold)", opacity: o, display: "inline-block",
      animation: `pulse 1.2s ${i * .2}s ease-in-out infinite` }} />))}</span>;
}
