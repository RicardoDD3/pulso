"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { GeneratedWeek, Phase } from "@/lib/training/plan-generator-types";

/* ------------------------------------------------------------------ */
/* Phase bar colors (solid fills for the timeline bar)                 */
/* ------------------------------------------------------------------ */

const PHASE_BAR_BG: Record<Phase, string> = {
  base: "bg-blue-500/70",
  build: "bg-green-500/70",
  peak: "bg-orange-500/70",
  taper: "bg-purple-500/70",
  race: "bg-red-500/70",
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface PhaseBlock {
  phase: Phase;
  startIdx: number; // first week index in this block
  count: number; // number of weeks
  weekNumbers: number[]; // e.g. [1,2,3,4]
  totalKm: number;
  hasRestWeeks: boolean;
}

interface EnhancedTimelineProps {
  weeks: GeneratedWeek[];
  currentWeekIdx: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function buildPhaseBlocks(weeks: GeneratedWeek[]): PhaseBlock[] {
  if (weeks.length === 0) return [];

  const blocks: PhaseBlock[] = [];
  let current: PhaseBlock | null = null;

  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    if (!current || current.phase !== w.phase) {
      if (current) blocks.push(current);
      current = {
        phase: w.phase,
        startIdx: i,
        count: 1,
        weekNumbers: [w.weekNumber],
        totalKm: w.totalKm,
        hasRestWeeks: w.isRestWeek,
      };
    } else {
      current.count++;
      current.weekNumbers.push(w.weekNumber);
      current.totalKm += w.totalKm;
      if (w.isRestWeek) current.hasRestWeeks = true;
    }
  }
  if (current) blocks.push(current);

  return blocks;
}

function getKeySessionWeeks(weeks: GeneratedWeek[]): Set<number> {
  const result = new Set<number>();
  for (const week of weeks) {
    if (week.days.some((d) => d.isKeySession)) {
      result.add(week.weekNumber);
    }
  }
  return result;
}

function getRestWeekIndices(weeks: GeneratedWeek[]): Set<number> {
  const result = new Set<number>();
  for (let i = 0; i < weeks.length; i++) {
    if (weeks[i].isRestWeek) {
      result.add(i);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function EnhancedTimeline({
  weeks,
  currentWeekIdx,
}: EnhancedTimelineProps) {
  const t = useTranslations("training.insights.timeline");
  const tPhases = useTranslations("training.insights.phases");
  const [hoveredBlock, setHoveredBlock] = useState<number | null>(null);

  const blocks = useMemo(() => buildPhaseBlocks(weeks), [weeks]);
  const keySessionWeeks = useMemo(() => getKeySessionWeeks(weeks), [weeks]);
  const restWeekIndices = useMemo(() => getRestWeekIndices(weeks), [weeks]);

  const totalWeeks = weeks.length;
  if (totalWeeks === 0) return null;

  // Compute position of current week marker as a percentage
  const currentWeekPct =
    currentWeekIdx >= 0
      ? ((currentWeekIdx + 0.5) / totalWeeks) * 100
      : -1;

  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-900/60 p-4 backdrop-blur-md">
      <h3 className="text-sm font-medium text-slate-300 mb-4">{t("title")}</h3>

      {/* Timeline bar container */}
      <div className="relative mb-6">
        {/* Current week marker */}
        {currentWeekPct >= 0 && (
          <div
            className="absolute -top-5 z-20 flex flex-col items-center"
            style={{ left: `${currentWeekPct}%`, transform: "translateX(-50%)" }}
          >
            <span className="text-[10px] font-medium text-green-400 mb-1">
              {t("weekShort", { n: currentWeekIdx + 1 })}
            </span>
            <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse shadow-lg shadow-green-400/40" />
          </div>
        )}

        {/* Main bar */}
        <div className="flex h-8 w-full mt-3">
          {blocks.map((block, blockIdx) => {
            const widthPct = (block.count / totalWeeks) * 100;
            const isFirst = blockIdx === 0;
            const isLast = blockIdx === blocks.length - 1;

            const roundedClass = [
              isFirst ? "rounded-l-full" : "",
              isLast ? "rounded-r-full" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={block.phase + "-" + block.startIdx}
                className={`relative h-8 ${PHASE_BAR_BG[block.phase]} ${roundedClass} cursor-pointer transition-opacity hover:opacity-90`}
                style={{ width: `${widthPct}%` }}
                onMouseEnter={() => setHoveredBlock(blockIdx)}
                onMouseLeave={() => setHoveredBlock(null)}
              >
                {/* Rest week dashed overlay — clipped to bar bounds */}
                <div className="absolute inset-0 overflow-hidden">
                  {Array.from({ length: block.count }).map((_, weekOffset) => {
                    const globalIdx = block.startIdx + weekOffset;
                    if (!restWeekIndices.has(globalIdx)) return null;
                    const offsetPct = (weekOffset / block.count) * 100;
                    const sliceWidth = 100 / block.count;
                    return (
                      <div
                        key={globalIdx}
                        className="absolute inset-y-0"
                        style={{
                          left: `${offsetPct}%`,
                          width: `${sliceWidth}%`,
                          backgroundImage:
                            "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.12) 3px, rgba(255,255,255,0.12) 5px)",
                        }}
                      />
                    );
                  })}
                </div>

                {/* Tooltip — outside overflow-hidden so it is not clipped */}
                {hoveredBlock === blockIdx && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30 pointer-events-none">
                    <div className="relative bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 shadow-xl whitespace-nowrap text-xs">
                      <div className="font-semibold text-white mb-1">
                        {tPhases(block.phase)}
                      </div>
                      <div className="text-slate-400">
                        {t("weekShort", { n: block.weekNumbers[0] })}&ndash;
                        {t("weekShort", { n: block.weekNumbers[block.weekNumbers.length - 1] })}
                      </div>
                      <div className="text-slate-400">
                        {t("kmTotal", { n: Math.round(block.totalKm) })}
                      </div>
                      <div className="text-slate-500 mt-1 max-w-[200px] text-[10px] leading-tight">
                        {t(`focus.${block.phase}`)}
                      </div>
                      {/* Tooltip arrow */}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-800" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Phase labels below bar */}
        <div className="flex mt-2">
          {blocks.map((block) => {
            const widthPct = (block.count / totalWeeks) * 100;
            return (
              <div
                key={"label-" + block.phase + "-" + block.startIdx}
                className="text-center text-[10px] font-medium text-slate-500 uppercase tracking-wider"
                style={{ width: `${widthPct}%` }}
              >
                {tPhases(block.phase)}
              </div>
            );
          })}
        </div>

        {/* Key session diamond markers */}
        <div className="relative h-4 mt-1">
          {weeks.map((week, idx) => {
            if (!keySessionWeeks.has(week.weekNumber)) return null;
            const positionPct = ((idx + 0.5) / totalWeeks) * 100;
            return (
              <div
                key={"diamond-" + idx}
                className="absolute top-1"
                style={{
                  left: `${positionPct}%`,
                  transform: "translateX(-50%) rotate(45deg)",
                }}
              >
                <div className="w-1.5 h-1.5 bg-amber-400" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
