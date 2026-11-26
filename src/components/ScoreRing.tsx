"use client";

import { motion, useReducedMotion } from "framer-motion";
import { getScoreTier } from "@/lib/score";

interface ScoreRingProps {
  score: number;
  /** Width and height in pixels. Default 64. */
  size?: number;
}

const STROKE_WIDTH = 6;
const VIEWBOX = 64;
const RADIUS = (VIEWBOX - STROKE_WIDTH) / 2;

/**
 * Circular score gauge. The ring sweeps once when it first appears;
 * the number in the middle is always visible and the whole thing has an aria-label.
 */
export function ScoreRing({ score, size = 64 }: ScoreRingProps) {
  const { color, label } = getScoreTier(score);
  const reduceMotion = useReducedMotion();
  const fraction = Math.min(Math.max(score, 0), 100) / 100;

  return (
    <div
      role="img"
      aria-label={`Match score ${score} out of 100. ${label}.`}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} width={size} height={size} aria-hidden="true">
        {/* Track */}
        <circle cx={VIEWBOX / 2} cy={VIEWBOX / 2} r={RADIUS} fill="none" stroke="#e4e4e7" strokeWidth={STROKE_WIDTH} />
        {/* Progress, starting at 12 o'clock */}
        <g transform={`rotate(-90 ${VIEWBOX / 2} ${VIEWBOX / 2})`}>
          <motion.circle
            cx={VIEWBOX / 2}
            cy={VIEWBOX / 2}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            initial={{ pathLength: reduceMotion ? fraction : 0 }}
            animate={{ pathLength: fraction }}
            transition={{ duration: reduceMotion ? 0 : 0.9, ease: "easeOut" }}
          />
        </g>
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-base font-semibold tabular-nums"
        style={{ color }}
      >
        {score}
      </span>
    </div>
  );
}
