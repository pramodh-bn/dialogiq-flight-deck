// v4 cards: build order and emphasis follow the narration (frames measured from voice-v4 word timings).
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, Frame, Logo, Rise, Rule, grotesk, useIn, useOut } from "./theme";

const pad: React.CSSProperties = { padding: "0 160px", justifyContent: "center" };
const win = (f: number, a: number, b: number) =>
  interpolate(f, [a, a + 8, b - 8, b], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// ---- Architecture -----------------------------------------------------------------------
type BoxProps = { x: number; y: number; w: number; h: number; title: string; sub: string; delay: number; accent?: boolean; on?: [number, number] };
const Box: React.FC<BoxProps> = ({ x, y, w, h, title, sub, delay, accent, on }) => {
  const f = useCurrentFrame();
  const p = useIn(delay, 14);
  const hi = on ? win(f, on[0], on[1]) : 0;
  return (
    <div
      style={{
        position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 28,
        background: accent ? C.tealDim : C.panel,
        border: `3px solid ${accent || hi > 0.5 ? C.teal : C.line}`,
        boxShadow: `0 0 ${40 * hi}px rgba(49,182,173,${0.45 * hi})`,
        display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
        opacity: Math.min(1, p * 1.5), transform: `scale(${(0.85 + 0.15 * p) * (1 + 0.04 * hi)})`,
      }}
    >
      <div style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 56, color: C.bright }}>{title}</div>
      <div style={{ fontSize: 26, color: C.muted, marginTop: 10, textAlign: "center", lineHeight: 1.3, whiteSpace: "pre-line" }}>{sub}</div>
    </div>
  );
};

const Arrow: React.FC<{ x1: number; y1: number; x2: number; y2: number; delay: number; label?: string; lx?: number; ly?: number; id: string }> = ({
  x1, y1, x2, y2, delay, label, lx, ly, id,
}) => {
  const p = useIn(delay);
  const len = Math.hypot(x2 - x1, y2 - y1);
  return (
    <>
      <svg style={{ position: "absolute", left: 0, top: 0 }} width={1920} height={1080}>
        <defs>
          <marker id={id} markerWidth="10" markerHeight="10" refX="6" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={C.teal} />
          </marker>
        </defs>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.teal} strokeWidth={5} strokeDasharray={len} strokeDashoffset={len * (1 - p)} markerEnd={p > 0.95 ? `url(#${id})` : undefined} />
      </svg>
      {label && (
        <div style={{ position: "absolute", left: lx, top: ly, fontSize: 26, color: C.text, opacity: p, width: label === "hint" ? 140 : 360, textAlign: label === "hint" ? "right" : "center" }}>
          {label}
        </div>
      )}
    </>
  );
};

const LockIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={1.8} strokeLinecap="round">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

// Narration (scene frames): Bob 90, judge 257, coach 358, "never Bob's hidden needs" 517, punchline 584.
export const DiagramCard4: React.FC = () => {
  const frame = useCurrentFrame();
  const out = useOut();
  const wall = useIn(515, 18);
  const pulse = 0.6 + 0.4 * Math.sin((frame - 515) / 6);
  const title = interpolate(frame, [574, 584], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const punch = useIn(586);
  return (
    <Frame>
      <AbsoluteFill style={{ opacity: out }}>
        <div style={{ position: "absolute", top: 70, left: 160 }}>
          <Rise delay={0}>
            <div style={{ fontSize: 26, color: C.teal, letterSpacing: 3, fontWeight: 600 }}>HOW IT WORKS</div>
          </Rise>
          <div style={{ position: "relative", height: 90, marginTop: 8, width: 1600, whiteSpace: "nowrap" }}>
            <Rise delay={0} style={{ position: "absolute", opacity: title }}>
              <div style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 64, color: C.bright, opacity: title }}>Three roles, kept apart.</div>
            </Rise>
            <div style={{ position: "absolute", opacity: punch, transform: `translateY(${(1 - punch) * 30}px)`, fontFamily: grotesk, fontWeight: 700, fontSize: 48, color: C.bright, whiteSpace: "nowrap" }}>
              A good coach shouldn't know the answers. <span style={{ color: C.teal }}>It should know you.</span>
            </div>
          </div>
        </div>

        <Box x={160} y={330} w={400} h={220} title="You" sub="the manager" delay={20} accent />
        <Arrow id="a1" x1={570} y1={440} x2={1000} y2={440} delay={70} label="practice turn" lx={605} ly={390} />
        <Box x={1010} y={300} w={460} h={280} title="Bob" sub={"AI direct report\nMuse Spark Open · Baseten"} delay={85} on={[88, 252]} />

        <Rise delay={170} style={{ position: "absolute", left: 1520, top: 330 }}>
          <div style={{ width: 300, height: 220, borderRadius: 24, border: `3px dashed ${C.muted}`, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
            <LockIcon size={58} />
            <div style={{ fontSize: 28, color: C.text, marginTop: 10, textAlign: "center" }}>
              Bob's hidden
              <br />
              needs
            </div>
          </div>
        </Rise>

        <Box x={1010} y={730} w={460} h={220} title="Judge" sub={"deterministic\nscores each turn"} delay={254} on={[256, 356]} />
        <Arrow id="a2" x1={1240} y1={585} x2={1240} y2={725} delay={266} />
        <Box x={160} y={730} w={400} h={220} title="Coach" sub={"one next move\nMuse Spark Open · Fireworks"} delay={356} on={[358, 580]} />
        <Arrow id="a3" x1={360} y1={725} x2={360} y2={560} delay={372} label="hint" lx={200} ly={622} />

        <div style={{ position: "absolute", left: 640, top: 690, width: 6, height: 300 * wall, background: C.teal, opacity: pulse * Math.min(1, wall * 2), borderRadius: 3 }} />
        <Rise delay={524} style={{ position: "absolute", left: 680, top: 790, width: 300 }}>
          <div style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 36, color: C.teal, lineHeight: 1.15 }}>The coach never sees Bob's hidden needs.</div>
        </Rise>
      </AbsoluteFill>
    </Frame>
  );
};

// ---- Stats: "23" spoken at 144, "52" at 166, "And when Bob asked to stop" 308, "six out of six" 384 ----
export const StatsCard4: React.FC = () => {
  const frame = useCurrentFrame();
  const out = useOut();
  const count = Math.round(interpolate(frame, [142, 168], [23, 52], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const bar = (n: number) => (n / 78) * 1000;
  const second = useIn(306);
  const six = useIn(384, 12);
  return (
    <Frame>
      <AbsoluteFill style={{ ...pad, opacity: out }}>
        <Rise delay={0}>
          <div style={{ fontSize: 26, color: C.teal, letterSpacing: 3, fontWeight: 600 }}>WHAT IMPROVED</div>
        </Rise>
        <div style={{ display: "flex", alignItems: "baseline", gap: 28, marginTop: 24 }}>
          <Rise delay={10}>
            <span style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 260, color: C.bright, lineHeight: 1 }}>{count}</span>
          </Rise>
          <Rise delay={14}>
            <span style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 80, color: C.muted }}>/ 78</span>
          </Rise>
        </div>
        <Rise delay={60} style={{ fontSize: 40, color: C.text, marginTop: 8 }}>
          usable coach hints · <span style={{ color: C.muted }}>23 before the coach redesign</span>
        </Rise>
        <Rise delay={22} style={{ marginTop: 36 }}>
          <div style={{ width: 1000, height: 22, background: C.panel, borderRadius: 11, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: 22, width: bar(count), background: C.teal, borderRadius: 11 }} />
            <div style={{ position: "absolute", left: bar(23) - 2, top: 0, width: 4, height: 22, background: C.bg }} />
          </div>
        </Rise>
        <Rise delay={218} style={{ fontSize: 26, color: C.muted, marginTop: 16 }}>
          Agent-graded tests · small sample
        </Rise>

        <div style={{ marginTop: 70, display: "flex", alignItems: "center", gap: 32, opacity: second, transform: `translateY(${(1 - second) * 40}px)` }}>
          <span style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 110, color: C.teal, lineHeight: 1, transform: `scale(${1 + 0.12 * six * (1 - six) * 4})`, display: "inline-block" }}>6/6</span>
          <span style={{ fontSize: 40, color: C.text, lineHeight: 1.25 }}>
            times Bob asked to stop,
            <br />
            the coach respected it
          </span>
        </div>
      </AbsoluteFill>
    </Frame>
  );
};

// ---- Closing: CTA line at 128 ------------------------------------------------------------
export const ClosingCard4: React.FC = () => {
  const frame = useCurrentFrame();
  const glow = interpolate(frame, [0, 60], [0, 1], { extrapolateRight: "clamp" });
  const cta = useIn(126, 14);
  return (
    <Frame>
      <AbsoluteFill
        style={{
          justifyContent: "center", alignItems: "center", textAlign: "center",
          background: `radial-gradient(circle at 50% 45%, rgba(49,182,173,${0.14 * glow}) 0%, transparent 55%)`,
        }}
      >
        <Rise delay={0}>
          <Logo size={150} />
        </Rise>
        <div style={{ marginTop: 50 }}>
          <Rule delay={18} width={360} />
        </div>
        <Rise delay={28} style={{ marginTop: 50 }}>
          <div style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 72, color: C.bright, lineHeight: 1.15 }}>
            Practice the conversation
            <br />
            <span style={{ color: C.teal }}>before it matters.</span>
          </div>
        </Rise>
        <Rise delay={50} style={{ marginTop: 56 }}>
          <div
            style={{
              fontSize: 40, fontWeight: 600, color: C.bright, padding: "14px 30px", borderRadius: 16,
              border: `3px solid rgba(49,182,173,${0.25 + 0.75 * cta})`, background: `rgba(49,182,173,${0.12 * cta})`,
              transform: `scale(${1 + 0.05 * cta})`,
            }}
          >
            github.com/pramodh-bn/dialogiq-flight-deck
          </div>
        </Rise>
      </AbsoluteFill>
    </Frame>
  );
};
