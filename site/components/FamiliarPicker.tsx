"use client";
import { useState } from "react";
import { updateSave } from "@/lib/save";

// Who is shopping today. Week one summons a familiar; this lab stands alone, so the
// street lets you pick one at the door. Thirty sparks in the purse, same as everyone.

const SPECIES: [string, string][] = [
  ["cat", "Mochi"], ["fox", "Rusty"], ["owl", "Pip"], ["dragon", "Ember"],
  ["bear", "Bramble"], ["bunny", "Clover"], ["deer", "Fern"], ["dog", "Biscuit"],
];

export default function FamiliarPicker({ onDone }: { onDone: () => void }) {
  const [pick, setPick] = useState<string>("cat");
  const [name, setName] = useState<string>("Mochi");

  const go = () => {
    const src = `/world/icons/species/${pick}.jpg`;
    updateSave({ name: name.trim() || "Mochi", portrait: src, origin: src, sparks: 30, outfit: [], inventory: [] });
    onDone();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center",
      background: "rgba(60,50,90,.35)", backdropFilter: "blur(6px)" }}>
      <div className="glass" style={{ padding: "26px 30px 24px", width: 560, textAlign: "center",
        animation: "riseIn .35s ease both" }}>
        <div className="eyebrow">MARKET STREET</div>
        <h2 className="serif" style={{ fontWeight: 500, fontSize: 26, margin: "6px 0 16px" }}>Who&apos;s shopping today?</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
          {SPECIES.map(([s, n]) => (
            <button key={s} onClick={() => { setPick(s); setName(n); }}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
              <img src={`/world/icons/species/${s}.jpg`} alt={s} width={96} height={96}
                style={{ width: 96, height: 96, borderRadius: 24, objectFit: "cover", display: "block", margin: "0 auto",
                  border: `3px solid ${pick === s ? "var(--gold)" : "transparent"}`,
                  boxShadow: pick === s ? "0 0 0 4px rgba(230,192,105,.3), 0 10px 24px rgba(185,138,46,.25)" : "0 6px 16px rgba(120,100,180,.12)",
                  transform: pick === s ? "scale(1.06)" : "scale(1)", transition: "all .2s" }} />
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center" }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }}
            style={{ padding: "11px 14px", borderRadius: 12, fontSize: 15, width: 200, textAlign: "center",
              border: "1px solid var(--gold)", background: "#fffdf6", color: "var(--ink)" }} />
          <button className="rune on" onClick={go} style={{ fontSize: 14, padding: "11px 18px" }}>✦ 30 · enter the street</button>
        </div>
      </div>
    </div>
  );
}
