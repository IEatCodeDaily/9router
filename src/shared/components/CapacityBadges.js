"use client";

import { CAPACITY_META, formatContextWindow } from "@/shared/constants/models";
import Tooltip from "./Tooltip";

// Render small icon badges for a model's capabilities (only those set true).
// colorOverride: force a single color class for all badges (default: per-cap color).
// size: icon font-size in px (default 16).
export default function CapacityBadges({ caps, className = "", colorOverride, size = 16, showContext = true }) {
  if (!caps) return null;
  const active = Object.keys(CAPACITY_META).filter((k) => caps[k]);
  const ctx = showContext ? formatContextWindow(caps.contextWindow) : null;
  if (active.length === 0 && !ctx) return null;

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {active.map((k) => (
        <Tooltip key={k} text={`${CAPACITY_META[k].label} — ${CAPACITY_META[k].desc}`}>
          <span
            className={`material-symbols-outlined leading-none cursor-help ${colorOverride || CAPACITY_META[k].color}`}
            style={{ fontSize: `${size}px` }}
          >
            {CAPACITY_META[k].icon}
          </span>
        </Tooltip>
      ))}
      {ctx && (
        <Tooltip text={`Context window: ${caps.contextWindow.toLocaleString()} tokens`}>
          <span
            className={`shrink-0 cursor-help rounded bg-black/5 px-1 py-0.5 font-mono leading-none dark:bg-white/5 ${colorOverride || "text-text-muted"}`}
            style={{ fontSize: `${Math.max(9, size - 3)}px` }}
          >
            {ctx}
          </span>
        </Tooltip>
      )}
    </span>
  );
}
