// v4: v3 plus the critique fixes (readable demo, pressure-vs-empathy card, narration-synced cards).
import React from "react";
import {
  AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig,
} from "remotion";
import timeline from "./timeline-v5.json";
import narration from "../narration-v5.json";
import events from "./demo-v3-events.json";
import { ClosingCard5, DiagramCard5, StatsCard5 } from "./Cards5";
import { C, Frame, Logo, grotesk, inter } from "./theme";

const FPS = 30;
const FADE = 6;
type Scene = { id: string; visual: string; frames: number; starts: number[] };
const beatsFor = (id: string): string[] =>
  ((narration.scenes as { id: string; beats?: string[] }[]).find((s) => s.id === id)?.beats ?? []);

const Transition: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, FADE, frames - FADE, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const s = interpolate(f, [0, 10], [1.03, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return <AbsoluteFill style={{ opacity: o, transform: `scale(${s})` }}>{children}</AbsoluteFill>;
};

const Accent: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(\*[^*]+\*)/).map((part, i) =>
      part.startsWith("*") ? <span key={i} style={{ color: C.teal }}>{part.slice(1, -1)}</span> : <span key={i}>{part}</span>,
    )}
  </>
);

const Beat: React.FC<{ text: string; at: number; next: number | null; size: number }> = ({ text, at, next, size }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - at, fps, config: { damping: 13, stiffness: 160, mass: 0.6 } });
  const dim = next === null ? 1 : interpolate(f, [next, next + 8], [1, 0.32], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (f < at) return null;
  return (
    <div
      style={{
        fontFamily: grotesk, fontWeight: 700, fontSize: size, lineHeight: 1.08, color: C.bright, marginBottom: size * 0.32,
        opacity: Math.min(1, p * 1.4) * dim, transform: `translateY(${(1 - p) * 40}px) scale(${0.92 + 0.08 * p})`,
        transformOrigin: "left center",
      }}
    >
      <Accent text={text} />
    </div>
  );
};

/** Product screenshot in a floating frame, slowly drifting. */
const Shot: React.FC<{ src: string; frames: number }> = ({ src, frames }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - 4, fps, config: { damping: 16 } });
  const drift = interpolate(f, [0, frames], [1.0, 1.06]);
  return (
    <div
      style={{
        position: "absolute", right: 90, top: 190, width: 860, height: 651, borderRadius: 22, overflow: "hidden",
        border: `2px solid ${C.line}`, boxShadow: "0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(49,182,173,.15)",
        opacity: p, transform: `translateX(${(1 - p) * 80}px) perspective(1600px) rotateY(-7deg)`,
      }}
    >
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${drift})`, transformOrigin: "0% 0%" }} />
    </div>
  );
};

type KProps = { scene: Scene; photo?: string; shot?: string; photoSide?: "left" | "right"; mode: "stack" | "replace"; size: number; top?: number };
const Kinetic: React.FC<KProps> = ({ scene, photo, shot, photoSide = "right", mode, size, top = 300 }) => {
  const f = useCurrentFrame();
  const beats = beatsFor(scene.id);
  const starts = scene.starts;
  const current = starts.reduce((acc, s, i) => (f >= s ? i : acc), 0);
  const push = interpolate(f, [0, scene.frames], [1.08, 1.18]);
  const slide = interpolate(f, [0, 14], [60, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const photoW = 700;
  const textLeft = photoSide === "left" && photo ? photoW + 110 : 150;
  const textRight = shot ? 1010 : photoSide === "right" && photo ? photoW + 60 : 120;
  return (
    <Frame>
      {photo && (
        <div
          style={{
            position: "absolute", top: 0, bottom: 0, width: photoW, overflow: "hidden",
            [photoSide]: 0, transform: `translateX(${photoSide === "right" ? slide : -slide}px)`,
          } as React.CSSProperties}
        >
          <Img src={staticFile(photo)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${push})` }} />
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${photoSide === "right" ? 90 : 270}deg, ${C.bg} 0%, transparent 35%)` }} />
        </div>
      )}
      {shot && <Shot src={shot} frames={scene.frames} />}
      <div style={{ position: "absolute", left: textLeft, top: 90 }}>
        <Logo size={40} />
      </div>
      {mode === "stack" ? (
        <div style={{ position: "absolute", left: textLeft, right: textRight, top }}>
          {beats.map((b, i) => <Beat key={i} text={b} at={starts[i] ?? 0} next={starts[i + 1] ?? null} size={size} />)}
        </div>
      ) : (
        <div style={{ position: "absolute", left: textLeft, right: textRight, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {beats.map((b, i) => (i === current ? <Beat key={i} text={b} at={starts[i] ?? 0} next={null} size={size} /> : null))}
        </div>
      )}
      {mode === "replace" && (
        <div style={{ position: "absolute", left: textLeft, bottom: 110, display: "flex", gap: 14 }}>
          {beats.map((_, i) => <div key={i} style={{ width: 46, height: 6, borderRadius: 3, background: i <= current ? C.teal : C.line }} />)}
        </div>
      )}
    </Frame>
  );
};

const DemoTitle: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: f, fps, config: { damping: 14 } });
  const b = spring({ frame: f - 9, fps, config: { damping: 14 } });
  return (
    <Frame>
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 160, fontFamily: grotesk, fontWeight: 700, fontSize: 96, lineHeight: 1.08 }}>
        <div style={{ opacity: a, transform: `translateY(${(1 - a) * 40}px)`, color: C.bright }}>One conversation.</div>
        <div style={{ opacity: b, transform: `translateY(${(1 - b) * 40}px)`, color: C.teal }}>Two possible outcomes.</div>
      </AbsoluteFill>
    </Frame>
  );
};

// ---- Demo -------------------------------------------------------------------------------
type Box = { x: number; y: number; w: number; h: number };
const ev = (label: string) => events.find((e) => e.label === label)!;
const boxOf = (label: string) => ev(label).box as Box;
const meters1: Box = { x: 1469, y: 330, w: 432, h: 360 };
const meters2: Box = { x: 1469, y: 420, w: 432, h: 330 };
const WIDE = { cx: 960, cy: 540, s: 1 };
const CHAT = { cx: 740, cy: 250, s: 1.3 };
const HOME = { cx: 660, cy: 560, s: 1.75 }; // keeps the DEMO DATA column (x > 1220) off-frame
const focus = (b: Box, s: number) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, s });
type Key = { t: number; cx: number; cy: number; s: number };
const hold = (t0: number, t1: number, v: { cx: number; cy: number; s: number }): Key[] => [{ t: t0, ...v }, { t: t1, ...v }];

const KEYS: Key[] = [
  ...hold(0, 0.6, HOME),
  ...hold(0.6, 4.6, HOME),
  ...hold(5.4, 7.8, focus(boxOf("bobCard"), 1.75)),
  ...hold(8.6, 9.7, focus(boxOf("arenaOpening"), 1.6)),
  ...hold(10.0, 11.1, focus(boxOf("arenaSituation"), 1.45)),
  ...hold(11.5, 12.8, focus({ x: 1469, y: 96, w: 432, h: 420 }, 1.7)),
  ...hold(13.6, 20.4, CHAT),
  ...hold(21.1, 22.8, focus(meters1, 2.15)),
  ...hold(23.6, 27.8, focus(boxOf("hintShown"), 2.15)),
  ...hold(28.5, 31.9, WIDE),
  ...hold(32.6, 34.1, focus(boxOf("rewindButton"), 1.8)),
  ...hold(35.0, 44.0, CHAT),
  ...hold(44.7, 46.4, focus(meters2, 2.1)),
  ...hold(47.1, 54.1, CHAT),
  ...hold(54.6, 55.4, focus(meters2, 2.1)),
  ...hold(56.0, 57.0, WIDE),
  { t: 61.5, cx: 1100, cy: 530, s: 1.1 },
];

function camera(t: number) {
  const i = KEYS.findIndex((k) => k.t > t);
  if (i === -1) return KEYS[KEYS.length - 1];
  if (i === 0) return KEYS[0];
  const a = KEYS[i - 1], b = KEYS[i];
  const p = Easing.inOut(Easing.cubic)((t - a.t) / (b.t - a.t));
  return { cx: a.cx + (b.cx - a.cx) * p, cy: a.cy + (b.cy - a.cy) * p, s: a.s + (b.s - a.s) * p };
}

export const LABELS: { t: number; d: number; text: string }[] = [
  { t: 0.6, d: 4.0, text: "Pick a scenario" },
  { t: 5.3, d: 2.6, text: "Bob · missed Q3 deadlines" },
  { t: 8.6, d: 1.3, text: "The character" },
  { t: 9.95, d: 1.3, text: "Your situation" },
  { t: 11.3, d: 1.6, text: "Live coaching" },
  { t: 13.4, d: 4.5, text: "Take 1 · lead with pressure" },
  { t: 21.1, d: 1.8, text: "Stance: guarded" },
  { t: 23.6, d: 4.2, text: "One coaching hint" },
  { t: 28.6, d: 3.8, text: "The Flight Tree" },
  { t: 32.6, d: 1.8, text: "Rewind to this moment" },
  { t: 36.9, d: 5.5, text: "Take 2 · acknowledge, then ask" },
  { t: 44.7, d: 1.9, text: "Empathy + open questions" },
  { t: 52.8, d: 2.6, text: "Bob names what he needs" },
  { t: 56.0, d: 1.6, text: "Two takes, one Flight Tree" },
];

const Label: React.FC<{ text: string; from: number; dur: number }> = ({ text, from, dur }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = f - from;
  if (local < 0 || local > dur) return null;
  const p = spring({ frame: local, fps, config: { damping: 15, stiffness: 180 } });
  const out = interpolate(local, [dur - 8, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute", left: 60, bottom: 28, padding: "14px 26px", borderRadius: 14, fontFamily: inter, fontWeight: 600,
        fontSize: 38, color: C.bright, background: "rgba(22,25,28,.9)", border: `3px solid ${C.teal}`,
        boxShadow: "0 12px 40px rgba(0,0,0,.45)", opacity: out * Math.min(1, p * 1.3), transform: `translateX(${(1 - p) * -60}px)`,
      }}
    >
      {text}
    </div>
  );
};

/** Verbatim excerpts from Bob's recorded replies, timed over the outcome close-ups. */
const PullQuote: React.FC<{ text: string; from: number; to: number }> = ({ text, from, to }) => {
  const f = useCurrentFrame();
  if (f < from || f > to) return null;
  const alpha = interpolate(f, [from, from + 8, to - 8, to], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{
    position: "absolute", left: 65, bottom: 160, width: 820, padding: "24px 32px",
    borderLeft: `6px solid ${C.teal}`, background: "rgba(22,25,28,.94)",
    color: C.bright, fontFamily: grotesk, fontSize: 47, fontWeight: 700, lineHeight: 1.15,
    opacity: alpha, boxShadow: "0 20px 50px rgba(0,0,0,.42)",
  }}>
    <div style={{ fontFamily: inter, fontSize: 22, color: C.teal, letterSpacing: 2, marginBottom: 11 }}>BOB · RECORDED REPLY</div>
    “{text}”
  </div>;
};

/** The payoff: both takes side by side, as the narrator names the outcomes. */
const Compare: React.FC<{ from: number }> = ({ from }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: f - from, fps, config: { damping: 15 } });
  const b = spring({ frame: f - from - 30, fps, config: { damping: 15 } });
  if (f < from) return null;
  const card = (p: number, good: boolean, take: string, how: string, stance: string, needs: string) => (
    <div
      style={{
        width: 640, padding: "28px 36px", borderRadius: 22, background: "rgba(22,25,28,.94)",
        border: `3px solid ${good ? C.teal : C.line}`, boxShadow: good ? "0 0 50px rgba(49,182,173,.35)" : "0 20px 50px rgba(0,0,0,.5)",
        opacity: p, transform: `translateY(${(1 - p) * 50}px)`,
      }}
    >
      <div style={{ fontSize: 26, letterSpacing: 3, fontWeight: 600, color: good ? C.teal : C.muted }}>{take}</div>
      <div style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 52, color: C.bright, marginTop: 6 }}>{how}</div>
      <div style={{ display: "flex", gap: 40, marginTop: 14, fontSize: 34, color: C.text }}>
        <span>Stance: <b style={{ color: good ? C.teal : C.muted }}>{stance}</b></span>
        <span>Needs: <b style={{ color: good ? C.teal : C.muted }}>{needs}</b></span>
      </div>
    </div>
  );
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 70 }}>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(0deg, rgba(22,25,28,${0.85 * a}) 0%, transparent 55%)` }} />
      <div style={{ display: "flex", gap: 40 }}>
        {card(a, false, "TAKE 1", "Pressure", "Guarded", "0 / 7")}
        {card(b, true, "TAKE 2", "Empathy", "Open", "2 / 7")}
      </div>
    </AbsoluteFill>
  );
};

const Demo: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const { cx, cy, s } = camera(t);
  const tx = Math.min(0, Math.max(1920 - 1920 * s, 960 - cx * s));
  const ty = Math.min(0, Math.max(1080 - 1080 * s, 540 - cy * s));
  const honest = interpolate(f, [10, 25, 150, 170], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Frame>
      <div style={{ position: "absolute", width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        <OffthreadVideo src={staticFile("demo-v3.mp4")} muted style={{ width: 1920, height: 1080 }} />
      </div>
      {LABELS.map((l) => <Label key={l.t} text={l.text} from={Math.round(l.t * FPS)} dur={Math.round(l.d * FPS)} />)}
      <PullQuote text="Specs changed twice mid-quarter" from={Math.round(20.6 * FPS)} to={Math.round(23.2 * FPS)} />
      <PullQuote text="Feels like every time I get traction the design changes" from={Math.round(44.3 * FPS)} to={Math.round(47.0 * FPS)} />
      <Compare from={Math.round(57.4 * FPS)} />
      <div
        style={{
          position: "absolute", right: 30, top: 26, opacity: honest * 0.95, fontSize: 22, color: C.text, fontFamily: inter,
          background: "rgba(22,25,28,.85)", padding: "8px 14px", borderRadius: 10,
        }}
      >
        Real product recording · live Muse Spark Open replies · waits shortened
      </div>
    </Frame>
  );
};

// ---- Assembly ---------------------------------------------------------------------------
const VISUALS: Record<string, (s: Scene) => React.ReactNode> = {
  hook: (s) => <Kinetic scene={s} photo="photos/hook.png" mode="replace" size={78} top={300} />,
  reframe: (s) => <Kinetic scene={s} photo="photos/reframe.png" mode="replace" size={84} top={350} />,
  intro: (s) => <Kinetic scene={s} shot="photos/dashboard.png" mode="replace" size={70} />,
  demoTitle: () => <DemoTitle />,
  demo: () => <Demo />,
  diagram: () => <DiagramCard5 />,
  stats: () => <StatsCard5 />,
  close: (s) => <Kinetic scene={s} photo="photos/close.png" photoSide="left" mode="stack" size={84} top={330} />,
  closing: () => <ClosingCard5 />,
};

export const totalFramesV5 = (timeline as Scene[]).reduce((n, s) => n + s.frames, 0);

export const PresentationV5: React.FC = () => {
  let from = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {(timeline as Scene[]).map((s) => {
        const start = from;
        from += s.frames;
        return (
          <Sequence key={s.id} from={start} durationInFrames={s.frames} name={s.id}>
            <Transition frames={s.frames}>{VISUALS[s.visual](s)}</Transition>
            <Audio src={staticFile(`voice-v5/${s.id}.wav`)} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
