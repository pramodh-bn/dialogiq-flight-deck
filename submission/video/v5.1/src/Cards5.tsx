import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import timeline from "./timeline-v5.json";
import { C, Frame, Logo, grotesk, inter } from "./theme";

const starts = (id: string): number[] => timeline.find((s) => s.id === id)?.starts ?? [];
const appear = (frame: number, at: number): number =>
  interpolate(frame, [at, at + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

export const DiagramCard5: React.FC = () => {
  const f = useCurrentFrame();
  const a = starts("arch");
  const rows = [
    { tag: "01  CHARACTER", title: "Bob", body: "Muse Spark Open  ·  Baseten", sub: "Hidden needs stay outside the coach's context." },
    { tag: "02  LOCAL FEEDBACK", title: "Stance + needs", body: "Local stance rules  ·  separate needs judge", sub: "Two signals, two mechanisms." },
    { tag: "03  COACH", title: "One next move", body: "Muse Spark Open  ·  Fireworks", sub: "Sees recent public dialogue. Never sees hidden needs." },
  ];
  return (
    <Frame>
      <div style={{ position: "absolute", left: 130, top: 64, fontFamily: inter, fontSize: 28, letterSpacing: 3, color: C.teal }}>HOW IT WORKS</div>
      <div style={{ position: "absolute", left: 130, top: 112, fontFamily: grotesk, fontWeight: 700, fontSize: 76, color: C.bright }}>Three roles. Clear boundaries.</div>
      <div style={{ position: "absolute", left: 130, right: 130, top: 250, display: "flex", flexDirection: "column", gap: 25 }}>
        {rows.map((r, i) => {
          const p = appear(f, Math.max(0, (a[i] ?? i * 140) - 8));
          const active = f >= (a[i] ?? 0) && f < (a[i + 1] ?? 99999);
          return <div key={r.tag} style={{ display: "flex", alignItems: "center", height: 215, padding: "20px 40px", borderRadius: 24, opacity: p, transform: `translateX(${(1 - p) * 55}px)`, background: active ? C.tealDim : C.panel, border: `3px solid ${active ? C.teal : C.line}` }}>
            <div style={{ width: 510, flexShrink: 0 }}>
              <div style={{ fontSize: 23, letterSpacing: 2, color: C.teal, fontWeight: 600 }}>{r.tag}</div>
              <div style={{ fontFamily: grotesk, fontSize: 57, color: C.bright, fontWeight: 700 }}>{r.title}</div>
            </div>
            <div style={{ fontSize: 34, color: C.bright, lineHeight: 1.3 }}>
              <div>{r.body}</div>
              <div style={{ marginTop: 7, fontSize: 27, color: C.muted }}>{r.sub}</div>
            </div>
          </div>;
        })}
      </div>
    </Frame>
  );
};

export const StatsCard5: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = starts("stats");
  const countStart = (a[1] ?? 80) + 15;
  const count = Math.round(interpolate(f, [countStart, countStart + 30], [23, 52], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const p = spring({ frame: f - countStart - 30, fps, config: { damping: 10 } });
  const stop = appear(f, (a[2] ?? 220) - 5);
  return <Frame>
    <div style={{ position: "absolute", left: 135, top: 70, fontSize: 26, letterSpacing: 3, fontWeight: 600, color: C.teal }}>SMALL AGENT-GRADED TEST  ·  78 HINTS</div>
    <div style={{ position: "absolute", left: 135, top: 140, fontFamily: grotesk, fontWeight: 700, fontSize: 74, color: C.bright }}>Did the hints fit the moment?</div>
    <div style={{ position: "absolute", left: 145, top: 315, display: "flex", alignItems: "baseline", gap: 35 }}>
      <span style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 185, color: C.muted }}>23</span>
      <span style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 90, color: C.teal }}>→</span>
      <span style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 230, color: C.bright, display: "inline-block", transform: `scale(${1 + Math.max(0, p - 1) * 0.16})` }}>{count}</span>
      <span style={{ fontSize: 55, color: C.muted }}>/ 78</span>
    </div>
    <div style={{ position: "absolute", left: 145, top: 585, fontSize: 40, color: C.text }}>Usable coach hints after redesign</div>
    <div style={{ position: "absolute", left: 145, top: 725, opacity: stop, transform: `translateY(${(1 - stop) * 35}px)`, display: "flex", gap: 35, alignItems: "center" }}>
      <span style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 120, color: C.teal }}>6/6</span>
      <span style={{ fontSize: 39, lineHeight: 1.23, color: C.bright }}>hints in one stop-request case<br />respected Bob’s request</span>
    </div>
    <div style={{ position: "absolute", left: 145, bottom: 48, fontSize: 25, color: C.muted }}>Agent-graded cases; this is not a measured learner outcome.</div>
  </Frame>;
};

export const ClosingCard5: React.FC = () => {
  const f = useCurrentFrame();
  const a = starts("tag");
  const p = appear(f, 10);
  const q = appear(f, a[1] ?? 100);
  return <Frame>
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", background: "radial-gradient(circle at 50% 42%, rgba(49,182,173,.19), transparent 58%)" }}>
      <div style={{ opacity: p, transform: `scale(${0.85 + 0.15 * p})` }}><Logo size={150} /></div>
      <div style={{ marginTop: 38, opacity: p, fontFamily: grotesk, fontSize: 76, lineHeight: 1.15, fontWeight: 700, color: C.bright }}>Practice the conversation<br /><span style={{ color: C.teal }}>before it matters.</span></div>
      <div style={{ marginTop: 65, opacity: q, fontFamily: inter, fontSize: 42, fontWeight: 600, color: C.bright, padding: "18px 32px", border: `3px solid ${C.teal}`, borderRadius: 18 }}>github.com/pramodh-bn/dialogiq-flight-deck</div>
    </AbsoluteFill>
  </Frame>;
};
