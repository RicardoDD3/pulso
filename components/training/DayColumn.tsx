"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { GeneratedDay, SessionType } from "@/lib/training/plan-generator-types";
import {
  formatStepsCompact,
  type StrengthDayStatus,
  type ExerciseTotal,
  type SwapSection,
} from "@/lib/training/week-tracks";
import {
  sessionActuals,
  daySessionSlots,
  runsBySlot,
  nextRunRef,
  partitionExtrasForDisplay,
  MAIN_REF,
  NONE_REF,
  Z2_BONUS_REF,
  type AssignableRun,
} from "@/lib/training/run-assignment";
import { formatPaceMinKm } from "@/lib/training/activity-match";
import { SESSION_COLORS } from "@/lib/training/plan-static-data";

const SESSION_LABEL_KEYS = ["z2", "hiit", "long_run", "back_to_back", "rest"] as const;

const EXTRA_TYPE_OPTIONS: SessionType[] = ["z2", "hiit", "long_run", "back_to_back"];

function formatShortDate(iso: string, locale: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

export interface SectionDragHandlers {
  isSelected: boolean;
  isDragOver: boolean;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onTap?: () => void;
}

/** Arrastrar un cuadrito extra (carryover/manual) a otro día. */
export interface ExtraDragHandlers {
  draggable: boolean;
  isPicked: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  /** Tap para "levantar"/soltar el chip (táctil). */
  onPick?: () => void;
}

/** El día como zona de drop para un extra que se está moviendo. */
export interface ExtraDropHandlers {
  /** Hay un extra "levantado" (mostrar afordancias de drop). */
  active: boolean;
  isOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  /** Tap en el día para soltar aquí (táctil). */
  onDropTap?: () => void;
}

/** Ejercicio de pesas registrado en el día (desde exercise_sets). */
export interface DayStrengthDetail {
  emoji: string;
  label: string;
  setCount: number;
}

/** Carrera del día (renglón dentro del cuadrito de su sesión). */
export interface DayGarminActivity {
  activity_id: number;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_hr: number | null;
  max_hr: number | null;
}

interface DayColumnProps {
  day: GeneratedDay;
  /** Km reales de la actividad matcheada (null si no hay). */
  actualKm: number | null;
  /** Carreras del día en orden cronológico (se agrupan por sesión). */
  dayActivities?: DayGarminActivity[];
  strengthStatus?: StrengthDayStatus;
  /** Ejercicios de pesas del día (emoji, label, sets) para el box Fuerza. */
  strengthDetail?: DayStrengthDetail[];
  /** Totales de ejercicios con byDate (se filtra por la fecha del día). */
  exerciseTotals: ExerciseTotal[];
  /** Pasos del día (null si no hay dato). */
  steps: number | null;
  /** Meta diaria de pasos (meta semanal / 7) para colorear el box. */
  stepsDayGoal: number;
  /** Doble click en el box Correr: editar el día del plan. */
  onEditRun?: () => void;
  /** Crear una sesión extra de correr en este día (botón +). */
  onAddExtra?: (extra: { sessionType: SessionType; distanceKm: number }) => void;
  /** Quitar una sesión extra (los carryover quedan descartados). */
  onRemoveExtra?: (id: string) => void;
  /** Cambiar el tipo de una sesión extra (chip): z2/hiit/long_run/back_to_back. */
  onRetypeExtra?: (extraId: string, newType: SessionType) => void;
  /** Tap en el renglón de una carrera: reasignarla a una sesión ("none" = excluir). */
  onAssignRun?: (activityId: number, ref: string) => void;
  /** Ver el detalle completo (laps/ruta/elevación) de una carrera. */
  onShowRunDetail?: (activityId: number) => void;
  /** Doble click en el box Fuerza: registro rápido de sets de pesas. */
  onLogStrength?: () => void;
  /** Doble click en el box Ejercicios: registro rápido de reps de cuerpo. */
  onLogExercises?: () => void;
  drag: (section: SwapSection) => SectionDragHandlers;
  /** Handlers para arrastrar cada chip extra a otro día. */
  extraDrag?: (extraId: string) => ExtraDragHandlers;
  /** Handlers para que este día reciba un extra arrastrado. */
  extraDrop?: ExtraDropHandlers;
}

function boxSwapClasses(h: SectionDragHandlers): string {
  if (h.isSelected) return "ring-2 ring-blue-500 border-blue-500/60 scale-[1.02]";
  if (h.isDragOver) return "border-dashed border-blue-500 bg-blue-500/10 scale-[1.02]";
  return "";
}

export default function DayColumn({
  day,
  actualKm,
  dayActivities,
  strengthStatus,
  strengthDetail,
  exerciseTotals,
  steps,
  stepsDayGoal,
  onEditRun,
  onAddExtra,
  onRemoveExtra,
  onRetypeExtra,
  onAssignRun,
  onShowRunDetail,
  onLogStrength,
  onLogExercises,
  drag,
  extraDrag,
  extraDrop,
}: DayColumnProps) {
  const t = useTranslations("training.week");
  const locale = useLocale();
  const sessionLabel = (type: string): string =>
    (SESSION_LABEL_KEYS as readonly string[]).includes(type) ? t(`sessions.${type}`) : type;
  const runDrag = drag("run");
  const strengthDrag = drag("strength");
  const sessionColor = SESSION_COLORS[day.sessionType] || SESSION_COLORS.rest;
  const isRest = day.sessionType === "rest";
  const round1 = (x: number) => Math.round(x * 10) / 10;
  // Los pendientes (carryover) del MISMO tipo que la sesión principal se FUNDEN
  // en su número ("sumado a la próxima sesión del mismo tipo"); el resto son
  // cuadritos aparte.
  const { folded, chips } = partitionExtrasForDisplay(day);
  // Actual por cuadrito según la asignación de carreras del día
  // (fallback: total guardado si no hay actividades en el rango)
  const runs: AssignableRun[] = dayActivities ?? [];
  const split = sessionActuals(day, runs, actualKm);
  const slots = daySessionSlots(day);
  const grouped = runsBySlot(day, runs);
  // Meta y actual de la sesión principal, con los pendientes del mismo tipo
  // sumados (Vie Z2 19.7 + 4.7 pend = 24.4).
  const foldedTarget = folded.reduce((s, e) => s + (e.distanceKm || 0), 0);
  const mainTarget = round1(day.distanceKm + foldedTarget);
  const foldedActual = folded.reduce((s, e) => s + (split.extras[e.id] ?? 0), 0);
  const hasMainActual = split.main != null || folded.some((e) => split.extras[e.id] != null);
  const mainActual = hasMainActual ? round1((split.main ?? 0) + foldedActual) : null;
  const diff = mainActual != null ? round1(mainActual - mainTarget) : null;
  // Día vaciado (p. ej. su sesión se arrastró a otro día): sin objetivo propio,
  // se lee como vacío — sin etiqueta de tipo ni zona (el sessionType interno se
  // conserva para seguir hospedando una carrera del día, ver
  // daySessionSlots). Si además no hay carrera asignada, el box completo se
  // atenúa igual que Fuerza/Ejercicios/Pasos sin datos; si SÍ la hay, el box
  // conserva su color normal porque hay algo real que mirar.
  const isEmptyRun = !isRest && mainTarget === 0;

  // Renglón de una carrera dentro del cuadrito de su sesión.
  // Texto = tap para reasignar; lupa 🔎 = ver detalle (laps/ruta/elevación).
  const renderRunLine = (a: DayGarminActivity, ref: string) => {
    const km = Math.round((Number(a.distance_meters || 0) / 1000) * 10) / 10;
    const pace = formatPaceMinKm(a.distance_meters, a.duration_seconds);
    const excluded = ref === NONE_REF;
    const text = `${km} km${pace ? ` · ${pace}/km` : ""}${a.avg_hr ? ` · ♥${a.avg_hr}` : ""}`;
    const tappable = !!onAssignRun && slots.length > 0;

    const detailBtn = onShowRunDetail ? (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onShowRunDetail(a.activity_id);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="shrink-0 text-slate-500 hover:text-cyan-300 text-[10px] leading-none"
        title={t("runDetailTitle")}
      >
        &#128269;
      </button>
    ) : null;

    const label = (
      <>
        &#8986; {text}
        {excluded ? ` · ${t("excluded")}` : ""}
      </>
    );

    return (
      <div key={a.activity_id} className="flex items-center gap-1">
        {tappable ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAssignRun!(a.activity_id, nextRunRef(day, ref));
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={`flex-1 min-w-0 text-left text-[10px] truncate transition-colors ${
              excluded ? "text-slate-500 hover:text-slate-300" : "text-slate-300 hover:text-white"
            }`}
            title={excluded ? t("reincludeRun") : t("reassignRun")}
          >
            {label}
          </button>
        ) : (
          <span className={`flex-1 min-w-0 text-[10px] truncate ${excluded ? "text-slate-500" : "text-slate-300"}`}>
            {label}
          </span>
        )}
        {detailBtn}
      </div>
    );
  };

  // Mini-form para crear una sesión extra
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<SessionType>("z2");
  const [newKm, setNewKm] = useState("");

  const dayReps = exerciseTotals
    .map((tot) => ({ emoji: tot.emoji, label: tot.label, reps: tot.byDate?.[day.date] || 0 }))
    .filter((tot) => tot.reps > 0);

  return (
    <div
      className={`flex flex-col gap-1.5 min-w-0 rounded-lg transition-all ${
        extraDrop?.isOver
          ? "ring-2 ring-amber-500/70 bg-amber-500/5"
          : extraDrop?.active
            ? "ring-1 ring-amber-500/30"
            : ""
      }`}
      onDragOver={extraDrop?.onDragOver}
      onDragLeave={extraDrop?.onDragLeave}
      onDrop={extraDrop?.onDrop}
    >
      {/* Header del día (también recibe el tap para soltar un extra en táctil) */}
      <div
        className={`flex items-center gap-1 px-0.5 ${extraDrop?.active && extraDrop.onDropTap ? "cursor-pointer" : ""}`}
        onClick={extraDrop?.active ? extraDrop.onDropTap : undefined}
      >
        <span className="text-[10px] text-slate-500 font-medium">
          {day.dayLabel} {parseInt(day.date.split("-")[2], 10)}
        </span>
        {day.isKeySession && (
          <span className="text-amber-400 text-[10px]" title={t("keySession")}>&#9733;</span>
        )}
        {extraDrop?.active && (
          <span className="ml-auto text-[9px] text-amber-400/80">{t("dropHere")}</span>
        )}
      </div>

      {/* Box Correr (doble click = editar; click = seleccionar para swap) */}
      <div
        className={`rounded-lg p-2 border transition-all group ${boxSwapClasses(runDrag)} ${onEditRun ? "cursor-pointer hover:border-green-500/40" : ""} ${
          isEmptyRun && mainActual == null
            ? "border-slate-800/60 bg-slate-800/20 opacity-50"
            : `border-slate-700/40 ${sessionColor.bg}`
        }`}
        title={onEditRun ? t("editHint") : undefined}
        onClick={(e) => {
          e.stopPropagation();
          runDrag.onTap?.();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEditRun?.();
        }}
        draggable={runDrag.draggable}
        onDragStart={runDrag.onDragStart}
        onDragOver={runDrag.onDragOver}
        onDragLeave={runDrag.onDragLeave}
        onDrop={runDrag.onDrop}
        onDragEnd={runDrag.onDragEnd}
      >
        <div className="flex items-center gap-1">
          {!isEmptyRun && (
            <>
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sessionColor.dot}`} />
              <span className="text-[10px] font-medium text-slate-300 uppercase truncate">
                {sessionLabel(day.sessionType)}
              </span>
            </>
          )}
          {runDrag.isSelected && (
            <span className="ml-auto text-blue-400 text-[10px] font-medium">{t("move")}</span>
          )}
        </div>
        {!isRest && (mainTarget > 0 || mainActual != null) && (
          <p className="text-xs text-slate-200 font-medium mt-0.5">
            {mainActual != null ? (
              <>
                {mainTarget} &rarr; {mainActual}{" "}
                <span className={diff! >= 0 ? "text-green-400" : "text-red-400"}>
                  ({diff! >= 0 ? "+" : ""}{diff})
                </span>
              </>
            ) : (
              <>{mainTarget} km</>
            )}
          </p>
        )}
        {/* El guion es solo para el día vaciado SIN carrera: si hay actual
            (aunque el objetivo sea 0, p. ej. una sesión que se arrastró a
            otro día), arriba se muestra "0 → X (+X)" en su lugar. */}
        {isEmptyRun && mainActual == null && (
          <p data-testid="run-empty-dash" className="text-[10px] text-slate-700 mt-0.5">&mdash;</p>
        )}
        {folded.length > 0 && (
          <p
            className="text-[10px] text-amber-400/80 truncate"
            title={folded
              .map((e) =>
                t("pendingFromShort", {
                  km: e.distanceKm,
                  date: formatShortDate(e.carryoverFrom ?? day.date, locale),
                })
              )
              .join(" · ")}
          >
            {t("inclPending", { km: round1(foldedTarget) })}
          </p>
        )}
        {!isRest && !isEmptyRun && day.zone && (
          <p className="text-[10px] text-slate-400 truncate">{day.zone}</p>
        )}
        {((grouped.byRef[MAIN_REF]?.length ?? 0) > 0 ||
          folded.some((e) => (grouped.byRef[e.id]?.length ?? 0) > 0)) && (
          <div className="mt-1 space-y-0.5">
            {(grouped.byRef[MAIN_REF] ?? []).map((a) => renderRunLine(a, MAIN_REF))}
            {folded.flatMap((e) => (grouped.byRef[e.id] ?? []).map((a) => renderRunLine(a, e.id)))}
          </div>
        )}
      </div>

      {/* Z2 detectado: un 2º entrenamiento suave en un día de calidad NO es HIIT
          — se reconoce como Z2 (no cubre el HIIT, cuenta como km fáciles). */}
      {grouped.bonusZ2.length > 0 && (
        <div className={`rounded-lg p-2 border border-slate-700/40 ${(SESSION_COLORS.z2 || SESSION_COLORS.rest).bg}`}>
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${(SESSION_COLORS.z2 || SESSION_COLORS.rest).dot}`} />
            <span className="text-[10px] font-medium text-slate-300 uppercase truncate">Z2</span>
            <span className="ml-auto text-[10px] text-slate-400">{round1(split.bonusZ2)} km</span>
          </div>
          <p className="text-[10px] text-slate-400/70 truncate">{t("secondEasyRun")}</p>
          <div className="mt-1 space-y-0.5">
            {grouped.bonusZ2.map((a) => renderRunLine(a, Z2_BONUS_REF))}
          </div>
        </div>
      )}

      {/* Cuadritos extra de correr (manual / planner / carryover de otro tipo).
          Los pendientes del mismo tipo que la sesión principal se muestran
          fundidos en su número, no aquí. */}
      {chips.map((extra) => {
        const color = SESSION_COLORS[extra.sessionType] || SESSION_COLORS.rest;
        const covered = split.extras[extra.id];
        const done = covered != null && covered >= extra.distanceKm - 0.05;
        const eDrag = extraDrag?.(extra.id);
        return (
          <div
            key={extra.id}
            className={`rounded-lg p-2 border ${done ? "border-green-500/40" : "border-slate-700/40"} ${color.bg} group/extra relative transition-all ${
              eDrag?.isPicked ? "ring-2 ring-amber-500 scale-[1.02]" : ""
            } ${eDrag?.draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
            draggable={eDrag?.draggable}
            onDragStart={eDrag?.onDragStart}
            onDragEnd={eDrag?.onDragEnd}
          >
            <div className="flex items-center gap-1">
              {(eDrag?.draggable || eDrag?.onPick) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    eDrag?.onPick?.();
                  }}
                  className="text-slate-600 hover:text-amber-400 text-[10px] leading-none cursor-grab shrink-0"
                  title={t("dragExtraTitle")}
                >
                  &#8942;&#8942;
                </button>
              )}
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${color.dot}`} />
              {onRetypeExtra ? (
                <select
                  value={extra.sessionType}
                  onChange={(e) => onRetypeExtra(extra.id, e.target.value as SessionType)}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  draggable={false}
                  className="bg-transparent text-[10px] font-medium text-slate-300 uppercase outline-none cursor-pointer hover:text-white truncate -ml-0.5 max-w-[80px]"
                  title={t("retypeExtra")}
                >
                  {EXTRA_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type} className="bg-slate-800 text-slate-200 normal-case">
                      {sessionLabel(type)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[10px] font-medium text-slate-300 uppercase truncate">
                  {sessionLabel(extra.sessionType)}
                </span>
              )}
              {extra.isKeySession && (
                <span className="text-amber-400 text-[10px]" title={t("keySession")}>&#9733;</span>
              )}
              {onRemoveExtra && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveExtra(extra.id);
                  }}
                  className="ml-auto text-slate-500 hover:text-red-400 text-[11px] leading-none opacity-0 group-hover/extra:opacity-100 transition-opacity"
                  title={
                    extra.origin === "carryover"
                      ? t("discardCarryover")
                      : extra.origin === "moved"
                        ? t("removeMoved")
                        : t("removeExtra")
                  }
                >
                  &times;
                </button>
              )}
            </div>
            <p className="text-xs text-slate-200 font-medium mt-0.5">
              {covered != null ? (
                <>
                  {extra.distanceKm} &rarr; {Math.round(covered * 10) / 10}{" "}
                  <span className={done ? "text-green-400" : "text-red-400"}>
                    ({done ? "+" : ""}{Math.round((covered - extra.distanceKm) * 10) / 10})
                  </span>
                </>
              ) : (
                <>{extra.distanceKm} km</>
              )}
            </p>
            <p className="text-[10px] text-amber-400/80 truncate">
              {extra.origin === "carryover" && extra.carryoverFrom
                ? t("pendingFrom", { date: formatShortDate(extra.carryoverFrom, locale) })
                : extra.origin === "moved" && extra.movedFrom
                  ? t("movedFrom", { date: formatShortDate(extra.movedFrom, locale) })
                  : t("extraSession")}
            </p>
            {(grouped.byRef[extra.id]?.length ?? 0) > 0 && (
              <div className="mt-1 space-y-0.5">
                {grouped.byRef[extra.id].map((a) => renderRunLine(a, extra.id))}
              </div>
            )}
          </div>
        );
      })}

      {/* Crear sesión extra */}
      {adding ? (
        <div className="rounded-lg p-2 border border-slate-700/60 bg-slate-800/40 space-y-1">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as SessionType)}
            className="w-full bg-slate-900/60 border border-slate-700 rounded text-[10px] text-slate-200 px-1 py-0.5"
          >
            {EXTRA_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {sessionLabel(type)}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={newKm}
            onChange={(e) => setNewKm(e.target.value)}
            placeholder={t("kmPlaceholder")}
            className="w-full bg-slate-900/60 border border-slate-700 rounded text-[10px] text-slate-200 px-1 py-0.5"
            autoFocus
          />
          <div className="flex gap-1">
            <button
              onClick={() => {
                const km = parseFloat(newKm);
                if (Number.isFinite(km) && km > 0) {
                  onAddExtra?.({ sessionType: newType, distanceKm: km });
                  setAdding(false);
                  setNewKm("");
                }
              }}
              className="flex-1 text-[10px] font-medium rounded bg-green-500/20 text-green-400 border border-green-500/30 py-0.5 hover:bg-green-500/30"
            >
              {t("ok")}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setNewKm("");
              }}
              className="flex-1 text-[10px] rounded text-slate-400 border border-slate-700 py-0.5 hover:text-slate-200"
            >
              &times;
            </button>
          </div>
        </div>
      ) : (
        onAddExtra && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setAdding(true);
            }}
            className="rounded-lg border border-dashed border-slate-700/60 text-slate-600 hover:text-slate-300 hover:border-green-500/40 text-[10px] py-0.5 transition-colors"
            title={t("addExtraTitle")}
          >
            +
          </button>
        )
      )}

      {/* Carreras excluidas (ref "none"): renglón gris, tap = volver a contar */}
      {grouped.excluded.length > 0 && (
        <div className="rounded-lg p-1.5 border border-slate-800/60 bg-slate-800/20 space-y-0.5">
          {grouped.excluded.map((a) => renderRunLine(a, NONE_REF))}
        </div>
      )}

      {/* Box Fuerza (doble click = registrar pesas) */}
      <div
        className={`rounded-lg p-2 border transition-all ${boxSwapClasses(strengthDrag)} ${
          strengthStatus?.done
            ? "border-indigo-500/40 bg-indigo-500/20"
            : strengthStatus?.planned
              ? "border-slate-700/40 bg-indigo-500/10"
              : "border-slate-800/60 bg-slate-800/20 opacity-50"
        } cursor-grab`}
        title={onLogStrength ? t("logStrengthHint") : undefined}
        onClick={(e) => {
          e.stopPropagation();
          strengthDrag.onTap?.();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onLogStrength?.();
        }}
        draggable={strengthDrag.draggable}
        onDragStart={strengthDrag.onDragStart}
        onDragOver={strengthDrag.onDragOver}
        onDragLeave={strengthDrag.onDragLeave}
        onDrop={strengthDrag.onDrop}
        onDragEnd={strengthDrag.onDragEnd}
      >
        <div className="flex items-center gap-1">
          <span className={`text-[10px] font-medium uppercase ${strengthStatus?.planned || strengthStatus?.done ? "text-indigo-300" : "text-slate-600"}`}>
            {t("sessions.strength")}
          </span>
          {strengthStatus?.done && <span className="text-green-400 text-[10px]">&#10003;</span>}
          {strengthDrag.isSelected && (
            <span className="ml-auto text-blue-400 text-[10px] font-medium">{t("move")}</span>
          )}
        </div>
        {strengthDetail && strengthDetail.length > 0 ? (
          <div className="mt-0.5 space-y-0.5">
            {strengthDetail.map((s) => (
              <p key={s.label} className="text-[10px] text-slate-300 truncate" title={s.label}>
                {s.emoji} {s.label} &times;{s.setCount}
              </p>
            ))}
          </div>
        ) : strengthStatus?.done ? (
          <p className="text-[10px] text-slate-300 mt-0.5">
            {strengthStatus.exerciseCount > 0
              ? t("exerciseCount", { count: strengthStatus.exerciseCount })
              : t("done")}
          </p>
        ) : strengthStatus?.planned ? (
          <p className="text-[10px] text-slate-500 mt-0.5">{t("pending")}</p>
        ) : (
          <p className="text-[10px] text-slate-700 mt-0.5">&mdash;</p>
        )}
      </div>

      {/* Box Ejercicios (doble click = registrar reps) */}
      <div
        className={`rounded-lg p-2 border border-slate-800/60 bg-slate-800/20 ${dayReps.length === 0 ? "opacity-50" : ""} ${onLogExercises ? "cursor-pointer hover:border-teal-500/40" : ""}`}
        title={onLogExercises ? t("logExercisesHint") : undefined}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onLogExercises?.();
        }}
      >
        <span className={`text-[10px] font-medium uppercase ${dayReps.length > 0 ? "text-teal-300" : "text-slate-600"}`}>
          {t("exercisesLabel")}
        </span>
        {dayReps.length > 0 ? (
          <div className="mt-0.5 space-y-0.5">
            {dayReps.map((r) => (
              <p key={r.label} className="text-[10px] text-slate-300 truncate" title={r.label}>
                {r.emoji} {r.reps}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-slate-700 mt-0.5">&mdash;</p>
        )}
      </div>

      {/* Box Pasos (wearable, solo lectura) */}
      <div
        className={`rounded-lg p-2 border border-slate-800/60 bg-slate-800/20 ${steps == null || steps === 0 ? "opacity-50" : ""}`}
      >
        <span className={`text-[10px] font-medium uppercase ${steps != null && steps > 0 ? "text-sky-300" : "text-slate-600"}`}>
          {t("stepsLabel")}
        </span>
        {steps != null && steps > 0 ? (
          <p
            className={`text-[11px] font-medium mt-0.5 ${steps >= stepsDayGoal ? "text-green-400" : "text-slate-300"}`}
          >
            &#128099; {formatStepsCompact(steps)}
          </p>
        ) : (
          <p className="text-[10px] text-slate-700 mt-0.5">&mdash;</p>
        )}
      </div>
    </div>
  );
}
