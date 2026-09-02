"use client";

// WeekBoard — la vista editable de UNA semana del plan (port del WeekRow de
// UltraPlanView del original): 7 DayColumn + WeekTotalsColumn, drag/tap para
// mover secciones, chips extra, registro rápido y banner de rebalanceo.
// Reemplazo drop-in de WeekCard para planes en formato editable (GeneratedPlan);
// para planes en formato LLM viejo no renderiza nada (el padre conserva su
// fallback).

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { PlanRow, PlanWorkoutRow } from "./types";
import type {
  GeneratedPlan,
  GeneratedDay,
  ExtraSession,
  Phase,
} from "@/lib/training/plan-generator-types";
import { PHASE_COLORS } from "@/lib/training/plan-static-data";
import { isEditablePlan } from "@/lib/training/plan-generator-types";
import { getTodayISO, type TrainingActivity } from "@/lib/training/plan-insights";
import {
  proposeRebalance,
  rebalanceDismissKey,
  type RebalancePatch,
  type RebalanceMatch,
} from "@/lib/training/rebalance";
import {
  normalizeStrength,
  removeRestDays,
  moveSection,
  describeSectionMove,
  describeExtraMove,
  computeRunTotals,
  computeStrengthStatus,
  computeExerciseTotals,
  computeStepsTotals,
  WEEKLY_STEPS_GOAL_MIN,
  WEEKLY_STEPS_GOAL_MAX,
  type SwapSection,
  type SectionMoveInfo,
  type WeekManualWorkout,
  type WeekExerciseLog,
  type WeekExerciseSet,
  type WeekStepsEntry,
  type ExerciseDefLite,
} from "@/lib/training/week-tracks";
import { moveExtraBetweenDays, retypeExtraSessions } from "@/lib/training/carryover";
import { scheduleDragOpacity } from "@/lib/training/drag-visual";
import DayColumn, {
  type SectionDragHandlers,
  type DayStrengthDetail,
  type ExtraDragHandlers,
  type ExtraDropHandlers,
} from "./DayColumn";
import WeekTotalsColumn from "./WeekTotalsColumn";
import DayEditModal from "./DayEditModal";
import MergeSessionsModal from "./MergeSessionsModal";
import QuickLogModal from "./QuickLogModal";
import RebalanceBanner from "./RebalanceBanner";

interface WeekBoardProps {
  plan: PlanRow;
  weekNumber: number;
  /** Filas de training_plan_workouts del plan (todas; se filtra por semana). */
  workouts: PlanWorkoutRow[];
  readOnly?: boolean;
  onPlanChanged?: () => void;
}

/** Fila de la respuesta de matched-activities. */
interface WeekMatch {
  workout: PlanWorkoutRow;
  activity: TrainingActivity | null;
  activities: TrainingActivity[];
}

const RUN_TYPES = new Set(["easy_run", "long_run", "tempo", "intervals", "recovery_run"]);

function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// normalizeStrength migra planes viejos (sessionType "strength" → flag);
// removeRestDays convierte descansos a Z2 redistribuyendo km.
function normalizePlan(p: GeneratedPlan): GeneratedPlan {
  const clone: GeneratedPlan = JSON.parse(JSON.stringify(p));
  normalizeStrength(clone);
  removeRestDays(clone);
  return clone;
}

export default function WeekBoard({
  plan,
  weekNumber,
  workouts,
  readOnly = false,
  onPlanChanged,
}: WeekBoardProps) {
  const t = useTranslations("training.week");
  const editable = isEditablePlan(plan.planJson);
  const [error, setError] = useState<string | null>(null);

  // Copia local del plan para updates optimistas (swap/move).
  const [localPlanJson, setLocalPlanJson] = useState<GeneratedPlan | null>(() =>
    editable ? normalizePlan(plan.planJson as GeneratedPlan) : null
  );
  useEffect(() => {
    setLocalPlanJson(isEditablePlan(plan.planJson) ? normalizePlan(plan.planJson) : null);
  }, [plan.planJson]);

  // Catálogo de ejercicios (labels, emojis, metas semanales) + uuid por key
  // (el PATCH de metas del catálogo es por id, no por exercise_key).
  const [exerciseDefs, setExerciseDefs] = useState<ExerciseDefLite[]>([]);
  const [defIdByKey, setDefIdByKey] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/exercises/definitions")
      .then((r) => r.json())
      .then((data) => {
        type DefRow = {
          id: string;
          exerciseKey: string;
          label: string;
          emoji: string | null;
          type: "bodyweight" | "weighted";
          increment: number | null;
          weeklyGoal: number | null;
          isActive: boolean;
          sortOrder: number;
        };
        const rows: DefRow[] = data.definitions || [];
        setExerciseDefs(
          rows.map((d) => ({
            exercise_key: d.exerciseKey,
            label: d.label,
            emoji: d.emoji || "🏋️",
            type: d.type,
            weekly_goal: d.weeklyGoal ?? null,
            sort_order: d.sortOrder,
            is_active: d.isActive,
            increment: d.increment ?? 1,
          }))
        );
        setDefIdByKey(Object.fromEntries(rows.map((d) => [d.exerciseKey, d.id])));
      })
      .catch(() => {});
  }, []);

  // Meta semanal de pasos, editable. Cae a 150k–200k si no hay fila.
  const [stepsGoal, setStepsGoal] = useState<{ min: number; max: number }>({
    min: WEEKLY_STEPS_GOAL_MIN,
    max: WEEKLY_STEPS_GOAL_MAX,
  });
  useEffect(() => {
    fetch("/api/training/settings")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.stepsGoalMin === "number" && typeof d.stepsGoalMax === "number") {
          setStepsGoal({ min: d.stepsGoalMin, max: d.stepsGoalMax });
        }
      })
      .catch(() => {});
  }, []);

  // Actividades matcheadas (cada workout con las carreras de su fecha).
  const [matches, setMatches] = useState<WeekMatch[]>([]);
  useEffect(() => {
    fetch(`/api/training/plans/${plan.id}/matched-activities`)
      .then((r) => r.json())
      .then((data) => setMatches(data.matches || []))
      .catch(() => {});
  }, [plan.id, plan.updatedAt]);

  const planData = localPlanJson;
  const weekIndex = useMemo(
    () => (planData ? planData.weeks.findIndex((w) => w.weekNumber === weekNumber) : -1),
    [planData, weekNumber]
  );
  const week = weekIndex >= 0 ? planData!.weeks[weekIndex] : null;

  // Solo filas de corrida de ESTA semana: las filas "strength" no cuentan km
  // ni marcan días de corrida como completados (gotcha original #11).
  const runMatches = useMemo<RebalanceMatch[]>(
    () =>
      workouts
        .filter(
          (w) => w.weekNumber === weekNumber && RUN_TYPES.has(w.workoutType) && w.date != null
        )
        .map((w) => ({
          date: w.date as string,
          status: w.status,
          actual_distance_km: toNum(w.actualDistanceKm),
        })),
    [workouts, weekNumber]
  );

  // Carreras por fecha para la asignación por sesión (totales + cuadritos)
  const runsByDate = useMemo(() => {
    const map: Record<string, TrainingActivity[]> = {};
    for (const m of matches) {
      const date = m.workout.date;
      if (date && m.activities?.length && !map[date]) map[date] = m.activities;
    }
    return map;
  }, [matches]);

  // Datos reales de la semana (ejercicios, workouts manuales, sets, pasos)
  const [weekData, setWeekData] = useState<{
    logs: WeekExerciseLog[];
    workouts: WeekManualWorkout[];
    sets: WeekExerciseSet[];
    steps: WeekStepsEntry[];
  } | null>(null);

  const from = week?.days[0]?.date;
  const to = week ? week.days[week.days.length - 1]?.date : undefined;
  useEffect(() => {
    if (weekData || !from || !to) return;
    Promise.all([
      fetch(`/api/exercises/logs?from=${from}&to=${to}`).then((r) => r.json()).catch(() => ({ logs: [] })),
      fetch(`/api/training/workouts?from=${from}&to=${to}`).then((r) => r.json()).catch(() => ({ workouts: [] })),
      fetch(`/api/exercises/sets?from=${from}&to=${to}`).then((r) => r.json()).catch(() => ({ sets: [] })),
      fetch(`/api/health/steps?from=${from}&to=${to}`).then((r) => r.json()).catch(() => ({ steps: [] })),
    ]).then(([ex, wo, se, st]) => {
      type LogRow = { date: string; exerciseKey: string; reps: number };
      type ManualRow = { date: string; workoutType: string; exercises: { name: string }[] | null };
      type SetRow = { date: string; exerciseKey: string };
      type StepsRow = { date: string; steps: number | null };
      setWeekData({
        logs: ((ex.logs || []) as LogRow[]).map((l) => ({
          date: l.date,
          exercise: l.exerciseKey,
          reps: l.reps,
        })),
        workouts: ((wo.workouts || []) as ManualRow[]).map((w) => ({
          date: w.date,
          workout_type: w.workoutType,
          exercises: w.exercises,
        })),
        sets: ((se.sets || []) as SetRow[]).map((s) => ({ date: s.date, exercise: s.exerciseKey })),
        steps: (st.steps || []) as StepsRow[],
      });
    });
  }, [weekData, from, to]);

  /* ---------------- Mutaciones (plan_json) ---------------- */

  const applyServerPlan = useCallback(
    (planJson: GeneratedPlan) => {
      setLocalPlanJson(normalizePlan(planJson));
      onPlanChanged?.();
    },
    [onPlanChanged]
  );

  const resetLocal = useCallback(() => {
    setLocalPlanJson(isEditablePlan(plan.planJson) ? normalizePlan(plan.planJson) : null);
  }, [plan.planJson]);

  const handleMove = async (fromIndex: number, toIndex: number, section: SwapSection) => {
    // Optimista
    setLocalPlanJson((prev) => {
      if (!prev) return prev;
      const updated: GeneratedPlan = JSON.parse(JSON.stringify(prev));
      moveSection(updated.weeks[weekIndex], fromIndex, toIndex, section);
      return updated;
    });
    try {
      const res = await fetch(`/api/training/plans/${plan.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekIndex, fromDayIndex: fromIndex, toDayIndex: toIndex, section }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || t("board.moveError"));
      }
      const data = await res.json();
      applyServerPlan(data.plan_json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("board.moveError"));
      resetLocal();
    }
  };

  // Reasignar una carrera a otra sesión del día (⌚ tap): override PATCH.
  // Es una decisión de matching, NO una edición del plan — el route no
  // snapshotea versión en PATCHes de solo-override.
  const handleAssignRun = async (dayIndex: number, activityId: number, ref: string) => {
    try {
      const res = await fetch(`/api/training/plans/${plan.id}/day`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekIndex,
          dayIndex,
          updates: { runOverride: { activityId, ref } },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || t("board.assignError"));
      }
      const data = await res.json();
      applyServerPlan(data.plan_json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("board.assignError"));
    }
  };

  const handleMoveExtra = async (fromDayIndex: number, toDayIndex: number, extraId: string) => {
    // Optimista
    setLocalPlanJson((prev) => {
      if (!prev) return prev;
      const updated: GeneratedPlan = JSON.parse(JSON.stringify(prev));
      moveExtraBetweenDays(
        updated,
        { weekIndex, dayIndex: fromDayIndex },
        { weekIndex, dayIndex: toDayIndex },
        extraId
      );
      return updated;
    });
    try {
      const res = await fetch(`/api/training/plans/${plan.id}/day`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moveExtra: {
            fromWeekIndex: weekIndex,
            fromDayIndex,
            toWeekIndex: weekIndex,
            toDayIndex,
            extraId,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || t("board.moveExtraError"));
      }
      const data = await res.json();
      applyServerPlan(data.plan_json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("board.moveExtraError"));
      resetLocal();
    }
  };

  const handleExtrasChange = async (dayIndex: number, extraSessions: ExtraSession[]) => {
    try {
      const res = await fetch(`/api/training/plans/${plan.id}/day`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekIndex, dayIndex, updates: { extraSessions } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || t("board.extraError"));
      }
      const data = await res.json();
      applyServerPlan(data.plan_json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("board.extraError"));
    }
  };

  const handleGoalChange = async (exerciseKey: string, goal: number | null) => {
    const id = defIdByKey[exerciseKey];
    if (!id) throw new Error(t("board.goalError"));
    const res = await fetch(`/api/exercises/definitions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weeklyGoal: goal }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error?.message || t("board.goalError"));
    }
    setExerciseDefs((prev) =>
      prev.map((d) => (d.exercise_key === exerciseKey ? { ...d, weekly_goal: goal } : d))
    );
  };

  const handleStepsGoalChange = async (min: number, max: number) => {
    const res = await fetch("/api/training/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepsGoalMin: min, stepsGoalMax: max }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error?.message || t("board.stepsGoalError"));
    }
    const d = await res.json().catch(() => null);
    setStepsGoal(
      d && typeof d.stepsGoalMin === "number"
        ? { min: d.stepsGoalMin, max: d.stepsGoalMax }
        : { min, max }
    );
  };

  // POST /rebalance applies every patch under a SINGLE version snapshot.
  const handleRebalanceApply = async (patches: RebalancePatch[]) => {
    const res = await fetch(`/api/training/plans/${plan.id}/rebalance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patches: patches.map((p) => ({
          weekIndex: p.weekIndex,
          dayIndex: p.dayIndex,
          distanceKm: p.newKm,
        })),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error?.message || t("board.rebalanceError"));
    }
    const data = await res.json();
    if (data.planJson) applyServerPlan(data.planJson);
  };

  // Dismiss persists via /rebalance {dismiss}; falls back to client state.
  const handleRebalanceDismiss = async (weekIdx: number, key: string) => {
    setLocalDismissedKey(key);
    try {
      const res = await fetch(`/api/training/plans/${plan.id}/rebalance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismiss: { weekIndex: weekIdx, key } }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.planJson) applyServerPlan(data.planJson);
      }
    } catch {
      /* client-side dismissal already applied */
    }
  };

  /* ---------------- Estado de interacción (drag / tap) ---------------- */

  const [forceRebalance, setForceRebalance] = useState(false);
  // Sin route de rebalance no hay dónde persistir week.rebalanceDismissed:
  // el descarte vive en el cliente (se respeta el hash persistido si el
  // planner lo escribió).
  const [localDismissedKey, setLocalDismissedKey] = useState<string | null>(null);

  interface BoxRef {
    section: SwapSection;
    index: number;
  }
  const [dragSource, setDragSource] = useState<BoxRef | null>(null);
  const [dragOver, setDragOver] = useState<BoxRef | null>(null);
  const [tapSelected, setTapSelected] = useState<BoxRef | null>(null);

  // Movimiento pendiente de confirmar (fusión de dos sesiones del mismo tipo).
  const [pendingMove, setPendingMove] = useState<{
    from: number;
    to: number;
    section: SwapSection;
    info: SectionMoveInfo;
  } | null>(null);

  // Mover cuadritos extra (carryover/manual) entre días: arrastrar o tap.
  interface ExtraRef {
    index: number;
    extraId: string;
  }
  const [extraMove, setExtraMove] = useState<ExtraRef | null>(null);
  const [extraOverDay, setExtraOverDay] = useState<number | null>(null);

  // Movimiento de chip pendiente de confirmar: fundir tampoco se deshace
  // arrastrando.
  const [pendingExtraMove, setPendingExtraMove] = useState<{
    fromDayIndex: number;
    toDayIndex: number;
    extraId: string;
    info: SectionMoveInfo;
  } | null>(null);

  // Registro rápido por doble click (pesas / cuerpo)
  const [quickLog, setQuickLog] = useState<{
    mode: "strength" | "bodyweight";
    day: GeneratedDay;
  } | null>(null);

  const [editingDay, setEditingDay] = useState<{ dayIndex: number; day: GeneratedDay } | null>(null);

  // Detect if touch device (heuristic: pointer is coarse)
  const isTouchDevice =
    typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  const canEdit = !readOnly;

  if (!planData || !week || weekIndex < 0) return null;

  // Propuesta de rebalanceo (déficit/superávit vs targetKm de la semana)
  const rebalanceProposal = canEdit
    ? proposeRebalance(planData, weekIndex, runMatches, getTodayISO())
    : null;
  const rebalanceKey = rebalanceProposal
    ? rebalanceDismissKey(weekIndex, rebalanceProposal.deltaKm)
    : null;
  const rebalanceDismissed =
    rebalanceKey != null &&
    (week.rebalanceDismissed === rebalanceKey || localDismissedKey === rebalanceKey);
  const showRebalance = rebalanceProposal != null && (!rebalanceDismissed || forceRebalance);

  // Drop y tap terminan aquí: si la fusión es irreversible, confirma primero.
  const requestMove = (fromIdx: number, toIdx: number, section: SwapSection) => {
    const info = describeSectionMove(week, fromIdx, toIdx, section);
    if (!info) return;
    if (info.needsConfirm) {
      setDragSource(null);
      setDragOver(null);
      setTapSelected(null);
      setPendingMove({ from: fromIdx, to: toIdx, section, info });
      return;
    }
    handleMove(fromIdx, toIdx, section);
  };

  const handleTapMove = (section: SwapSection, index: number) => {
    if (tapSelected === null) {
      setTapSelected({ section, index });
    } else if (tapSelected.section === section && tapSelected.index === index) {
      setTapSelected(null); // deselect
    } else if (tapSelected.section === section) {
      requestMove(tapSelected.index, index, section);
      setTapSelected(null);
    } else {
      setTapSelected({ section, index }); // cambió de sección: re-selecciona
    }
  };

  const runTotals = computeRunTotals(week, runMatches, runsByDate);
  const strengthStatus = computeStrengthStatus(week, weekData?.workouts || [], weekData?.sets || []);
  const exerciseTotals = computeExerciseTotals(weekData?.logs || [], exerciseDefs);
  const stepsTotals = computeStepsTotals(weekData?.steps || [], stepsGoal.min, stepsGoal.max);

  // Ejercicios de pesas registrados por fecha (para el box Fuerza)
  const strengthDetailByDate = (() => {
    const counts = new Map<string, Map<string, number>>();
    for (const s of weekData?.sets || []) {
      const m = counts.get(s.date) || new Map<string, number>();
      m.set(s.exercise, (m.get(s.exercise) || 0) + 1);
      counts.set(s.date, m);
    }
    const defByKey = new Map(exerciseDefs.map((d) => [d.exercise_key, d]));
    const result = new Map<string, DayStrengthDetail[]>();
    for (const [date, m] of counts) {
      const list: DayStrengthDetail[] = [];
      for (const [key, setCount] of m) {
        const def = defByKey.get(key);
        list.push({ emoji: def?.emoji || "🏋️", label: def?.label || key, setCount });
      }
      result.set(date, list);
    }
    return result;
  })();

  // Km reales por fecha (solo corridas completadas)
  const actualByDate = new Map<string, number>();
  for (const m of runMatches) {
    if (m.status === "completed" && m.actual_distance_km != null) {
      actualByDate.set(m.date, (actualByDate.get(m.date) || 0) + m.actual_distance_km);
    }
  }

  // Handlers de drag por box (sección + día)
  const makeDragHandlers = (section: SwapSection, index: number): SectionDragHandlers => ({
    isSelected: tapSelected?.section === section && tapSelected.index === index,
    isDragOver:
      dragOver?.section === section &&
      dragOver.index === index &&
      !(dragSource?.section === section && dragSource.index === index),
    draggable: canEdit && !isTouchDevice,
    onDragStart: (e) => {
      setDragSource({ section, index });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${section}:${index}`);
      requestAnimationFrame(() => {
        (e.target as HTMLElement).style.opacity = "0.5";
      });
    },
    onDragOver: (e) => {
      if (extraMove) return; // hay un extra en vuelo: que lo capture el día, no el box
      if (dragSource && dragSource.section !== section) return; // sección distinta: no drop
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOver({ section, index });
    },
    onDragLeave: () => setDragOver(null),
    onDrop: (e) => {
      if (extraMove) return; // el drop del extra lo maneja la zona del día
      e.preventDefault();
      const [srcSection, srcIdxRaw] = (e.dataTransfer.getData("text/plain") || "").split(":");
      const srcIdx = parseInt(srcIdxRaw, 10);
      setDragOver(null);
      setDragSource(null);
      if (srcSection === section && !isNaN(srcIdx) && srcIdx !== index) {
        requestMove(srcIdx, index, section);
      }
    },
    onDragEnd: (e) => {
      (e.target as HTMLElement).style.opacity = "1";
      setDragSource(null);
      setDragOver(null);
    },
    onTap:
      canEdit && (isTouchDevice || tapSelected !== null) && extraMove === null
        ? () => handleTapMove(section, index)
        : undefined,
  });

  // Soltar el extra levantado en un día destino (drag o tap): si la colocación
  // funde con el destino, confirma primero — fundir no se deshace arrastrando.
  const dropExtraOn = (toDayIndex: number) => {
    const src = extraMove;
    setExtraMove(null);
    setExtraOverDay(null);
    if (!src || src.index === toDayIndex) return;

    const fromDay = week.days[src.index];
    const toDay = week.days[toDayIndex];
    const extra = (fromDay.extraSessions ?? []).find((e) => e.id === src.extraId);
    if (!extra) return;

    const info = describeExtraMove(fromDay, toDay, extra);
    if (info.needsConfirm) {
      setPendingExtraMove({ fromDayIndex: src.index, toDayIndex, extraId: src.extraId, info });
      return;
    }
    handleMoveExtra(src.index, toDayIndex, src.extraId);
  };

  // Handlers para arrastrar un chip extra (por día + id).
  const makeExtraDragHandlers = (dayIndex: number, extraId: string): ExtraDragHandlers => ({
    draggable: !isTouchDevice && canEdit,
    isPicked: extraMove?.index === dayIndex && extraMove.extraId === extraId,
    onDragStart: (e) => {
      setExtraMove({ index: dayIndex, extraId });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/x-extra", `${dayIndex}:${extraId}`);
      e.stopPropagation();
      // Leer currentTarget AHORA (síncrono): React lo pone en null tras el handler.
      scheduleDragOpacity(e.currentTarget as HTMLElement, "0.5");
    },
    onDragEnd: (e) => {
      (e.currentTarget as HTMLElement).style.opacity = "1";
      setExtraMove(null);
      setExtraOverDay(null);
    },
    // Tap: levantar / soltar en el mismo chip (deselect).
    onPick: !canEdit
      ? undefined
      : () => {
          if (extraMove?.index === dayIndex && extraMove.extraId === extraId) {
            setExtraMove(null);
          } else {
            setExtraMove({ index: dayIndex, extraId });
          }
        },
  });

  // Handlers para que un día reciba un extra.
  const makeExtraDropHandlers = (dayIndex: number): ExtraDropHandlers => ({
    active: extraMove != null,
    isOver: extraOverDay === dayIndex && extraMove != null && extraMove.index !== dayIndex,
    onDragOver: (e) => {
      if (!extraMove || extraMove.index === dayIndex) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setExtraOverDay(dayIndex);
    },
    onDragLeave: () => setExtraOverDay((d) => (d === dayIndex ? null : d)),
    onDrop: (e) => {
      if (!extraMove) return;
      e.preventDefault();
      dropExtraOn(dayIndex);
    },
    onDropTap:
      extraMove != null && extraMove.index !== dayIndex ? () => dropExtraOn(dayIndex) : undefined,
  });

  const phaseColors = PHASE_COLORS[week.phase as Phase] || PHASE_COLORS.rest;

  return (
    <div
      className="space-y-3"
      onClick={() => {
        // Click fuera de los días cancela tap-to-move / mover-extra
        if (tapSelected !== null) setTapSelected(null);
        if (extraMove !== null) setExtraMove(null);
      }}
    >
      {/* Meta de la semana: fase, km, fuerza */}
      <div className="flex items-center gap-2 flex-wrap px-0.5">
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${phaseColors.badge}`}
        >
          {t(`phases.${week.phase}`)}
        </span>
        <span className="text-xs text-slate-400 font-medium">{Math.round(week.totalKm)} km</span>
        <span className="text-xs text-slate-500">
          {t("board.strengthShort", { count: week.strengthSessions })}
        </span>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Propuesta de rebalanceo */}
      {showRebalance && rebalanceProposal && (
        <RebalanceBanner
          proposal={rebalanceProposal}
          onApply={async () => {
            await handleRebalanceApply(rebalanceProposal.patches);
            setForceRebalance(false);
          }}
          onDismiss={async () => {
            if (rebalanceKey) await handleRebalanceDismiss(weekIndex, rebalanceKey);
            setForceRebalance(false);
          }}
        />
      )}
      {rebalanceProposal && rebalanceDismissed && !forceRebalance && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setForceRebalance(true);
          }}
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          &#9878;&#65039; {t("rebalance.reopen")}
        </button>
      )}

      {/* Hint modo mover (tap) */}
      {tapSelected !== null && (
        <div className="text-[11px] text-blue-400 bg-blue-500/10 rounded-lg px-3 py-1.5 text-center">
          {t("board.tapMoveHint")}
        </div>
      )}

      {/* Hint mover extra */}
      {extraMove !== null && (
        <div className="text-[11px] text-amber-400 bg-amber-500/10 rounded-lg px-3 py-1.5 text-center">
          {t("board.extraMoveHint")}
        </div>
      )}

      {/* 8 columnas: 7 días (Correr / Fuerza / Ejercicios / Pasos) + Totales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {week.days.map((day, i) => (
          <DayColumn
            key={i}
            day={day}
            actualKm={actualByDate.get(day.date) ?? null}
            dayActivities={runsByDate[day.date]}
            strengthStatus={strengthStatus.days[day.date]}
            strengthDetail={strengthDetailByDate.get(day.date)}
            exerciseTotals={exerciseTotals}
            steps={stepsTotals.byDate[day.date] ?? null}
            stepsDayGoal={stepsTotals.goalMin / 7}
            onEditRun={
              canEdit && tapSelected === null ? () => setEditingDay({ dayIndex: i, day }) : undefined
            }
            onAddExtra={
              canEdit
                ? (extra) =>
                    handleExtrasChange(i, [
                      ...(day.extraSessions ?? []),
                      { id: "", origin: "manual", ...extra },
                    ])
                : undefined
            }
            onRemoveExtra={
              canEdit
                ? (id) =>
                    handleExtrasChange(
                      i,
                      (day.extraSessions ?? []).filter((e) => e.id !== id)
                    )
                : undefined
            }
            onRetypeExtra={
              canEdit
                ? (extraId, newType) =>
                    handleExtrasChange(i, retypeExtraSessions(day.extraSessions ?? [], extraId, newType))
                : undefined
            }
            onAssignRun={
              canEdit ? (activityId, ref) => handleAssignRun(i, activityId, ref) : undefined
            }
            onLogStrength={canEdit ? () => setQuickLog({ mode: "strength", day }) : undefined}
            onLogExercises={canEdit ? () => setQuickLog({ mode: "bodyweight", day }) : undefined}
            drag={(section) => makeDragHandlers(section, i)}
            extraDrag={canEdit ? (extraId) => makeExtraDragHandlers(i, extraId) : undefined}
            extraDrop={canEdit ? makeExtraDropHandlers(i) : undefined}
          />
        ))}
        <div className="col-span-2 sm:col-span-4 lg:col-span-1">
          <WeekTotalsColumn
            runTotals={runTotals}
            strengthStatus={strengthStatus}
            exerciseTotals={exerciseTotals}
            stepsTotals={stepsTotals}
            onGoalChange={canEdit ? handleGoalChange : undefined}
            onStepsGoalChange={canEdit ? handleStepsGoalChange : undefined}
          />
        </div>
      </div>

      {/* Notas de la semana */}
      {(week.nutritionNote || week.specificityNote) && (
        <div className="flex flex-wrap gap-3 text-[11px]">
          {week.nutritionNote && (
            <div className="flex items-start gap-1.5 text-amber-400/80">
              <span className="shrink-0">&#127828;</span>
              <span>{week.nutritionNote}</span>
            </div>
          )}
          {week.specificityNote && (
            <div className="flex items-start gap-1.5 text-teal-400/80">
              <span className="shrink-0">&#9889;</span>
              <span>{week.specificityNote}</span>
            </div>
          )}
        </div>
      )}

      {/* Registro rápido (doble click en box Fuerza / Ejercicios) */}
      {quickLog && (
        <QuickLogModal
          date={quickLog.day.date}
          dayLabel={quickLog.day.dayLabel}
          mode={quickLog.mode}
          defs={exerciseDefs}
          onClose={() => {
            setQuickLog(null);
            // Invalida el cache de la semana para refrescar los boxes
            setWeekData(null);
          }}
        />
      )}

      {editingDay && (
        <DayEditModal
          day={editingDay.day}
          weekIndex={weekIndex}
          dayIndex={editingDay.dayIndex}
          planId={plan.id}
          onSave={() => {
            setEditingDay(null);
            onPlanChanged?.();
          }}
          onClose={() => setEditingDay(null)}
        />
      )}

      {pendingMove && (
        <MergeSessionsModal
          info={pendingMove.info}
          onConfirm={() => {
            handleMove(pendingMove.from, pendingMove.to, pendingMove.section);
            setPendingMove(null);
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}

      {pendingExtraMove && (
        <MergeSessionsModal
          info={pendingExtraMove.info}
          onConfirm={() => {
            handleMoveExtra(
              pendingExtraMove.fromDayIndex,
              pendingExtraMove.toDayIndex,
              pendingExtraMove.extraId
            );
            setPendingExtraMove(null);
          }}
          onCancel={() => setPendingExtraMove(null)}
        />
      )}
    </div>
  );
}
