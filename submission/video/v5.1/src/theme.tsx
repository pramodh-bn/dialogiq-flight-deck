import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadGrotesk } from "@remotion/google-fonts/SpaceGrotesk";

// Palette and type sampled from the Gamma deck (What-if-you-could-rewind-...-3.pdf).
export const C = {
  bg: "#16191c",
  panel: "#1e2226",
  line: "#2c3237",
  text: "#e1e7e5",
  bright: "#f5f7f5",
  muted: "#a8b5b2",
  teal: "#31b6ad",
  tealDim: "rgba(49,182,173,0.16)",
};

export const inter = loadInter("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;
export const grotesk = loadGrotesk("normal", { weights: ["700"], subsets: ["latin"] }).fontFamily;

export const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: inter, color: C.text }}>{children}</AbsoluteFill>
);

/** Spring-driven 0→1 progress starting at `delay` frames. */
export const useIn = (delay: number, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping } });
};

/** Fade + rise entrance. */
export const Rise: React.FC<{ delay: number; children: React.ReactNode; style?: React.CSSProperties; dist?: number }> = ({
  delay,
  children,
  style,
  dist = 40,
}) => {
  const p = useIn(delay);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * dist}px)`, ...style }}>{children}</div>
  );
};

/** Whole-card fade out over the last `frames` frames. */
export const useOut = (frames = 15) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return interpolate(frame, [durationInFrames - frames, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

export const Logo: React.FC<{ size: number }> = ({ size }) => (
  <span style={{ fontFamily: inter, fontWeight: 600, fontSize: size, color: C.bright, letterSpacing: -0.5 }}>
    Dialog<span style={{ color: C.teal }}>IQ</span>
  </span>
);

export const Rule: React.FC<{ delay: number; width: number }> = ({ delay, width }) => {
  const p = useIn(delay);
  return <div style={{ height: 3, width: width * p, background: C.teal, borderRadius: 2 }} />;
};
