// plan-static-data.ts — Static constants for the deterministic training plan generator

import type { NutritionGuide, StrengthProgram } from "./plan-generator-types";

export const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function getDefaultPeakKm(raceDistanceKm: number): number {
  if (raceDistanceKm <= 25) return 40;
  if (raceDistanceKm <= 45) return 60;
  if (raceDistanceKm <= 50) return 100;
  if (raceDistanceKm <= 100) return 120;
  if (raceDistanceKm <= 160) return 150;
  if (raceDistanceKm <= 322) return 200;
  return 220;
}

export const NUTRITION_NOTES: Record<string, string[]> = {
  base: [
    "Practica gel cada 45min en long run",
    "Prueba diferentes marcas de gel",
    "Añade sólidos: plátano, papa",
    "",
    "Practica plan de hidratación completo",
    "Comer cada 30min en B2B",
    "Prueba comida de noche (sopa, quesadilla)",
    "",
  ],
  build: [
    "Practica nutrición nocturna",
    "Plan completo: calorías/hora objetivo",
    "Simula 12hrs de alimentación continua",
    "",
    "Ajusta calorías: 250-300 cal/hr",
    "Prueba todo el kit de carrera",
    "Ensayo general de nutrición",
    "",
  ],
  peak: [
    "Plan de nutrición final confirmado",
    "Practica menú exacto de carrera",
    "Simulación: 18hrs nutrición continua",
    "",
  ],
  taper: [
    "Carga de carbohidratos: empieza día 3",
    "Carga carbs: 8-10g/kg/día",
    "Carga carbs final + hidratación",
  ],
  race: ["EJECUTA TU PLAN DE NUTRICIÓN"],
};

export const SPECIFICITY_NOTES: Record<string, string[]> = {
  base: [
    "",
    "",
    "Primer B2B: corre Dom con fatiga del Sáb",
    "",
    "",
    "B2B: simula aid station cada 10km",
    "B2B con mochila de carrera",
    "",
  ],
  build: [
    "Primera corrida nocturna (Sáb noche)",
    "B2B con cambio de terreno",
    "Long run con 1000m+ desnivel",
    "",
    "Corrida nocturna #2",
    "B2B con crew/pacer simulado",
    "Simulación: 8hrs continuas con relevos",
    "",
  ],
  peak: [
    "Último long run nocturno",
    "B2B con terreno similar a carrera",
    "Simulación suave: volumen sin destruirte",
    "",
  ],
  taper: [
    "Sólo Z2 fácil, cero intensidad",
    "Shakeout runs cortos",
    "Revisión de equipo y drop bags",
  ],
  race: ["¡A CORRER!"],
};

export const RACE_NUTRITION_GUIDE: NutritionGuide = {
  phases: [
    {
      name: "Inicio (fresco)",
      hoursRange: "0-12",
      caloriesPerHour: "250-300",
      strategy:
        "Geles + sólidos alternados cada 30min. Hidratación: 500-750ml/hr con electrolitos",
    },
    {
      name: "Media carrera",
      hoursRange: "12-36",
      caloriesPerHour: "200-250",
      strategy:
        "Más sólidos: papa, arroz, sopa, quesadilla. Reduce geles. Café si es de noche",
    },
    {
      name: "Fatiga profunda",
      hoursRange: "36-60",
      caloriesPerHour: "150-200",
      strategy:
        "Lo que toleres: caldo, fruta, papas. Si hay náusea: solo líquidos por 30min",
    },
    {
      name: "Final push",
      hoursRange: "60-80",
      caloriesPerHour: "100-200",
      strategy:
        "Mantén algo entrando. Cola, caldo, lo que funcione. No experimentes",
    },
  ],
  targets: {
    totalCalories: "8,000 – 12,000 kcal",
    caloriesPerHour: "200-250 kcal/hr",
    totalLiquid: "30-50 litros",
    sodiumPerHour: "500-1000mg",
    carbLoadingPreRace: "8-10 g/kg/día (últimos 3 días)",
  },
};

export const STRENGTH_PROGRAM: StrengthProgram = {
  exercises: [
    {
      name: "Sentadilla búlgara",
      sets: 3,
      reps: "10/lado",
      restSeconds: 60,
      notes: "Con mancuerna. Clave para estabilidad de rodilla",
    },
    {
      name: "Peso muerto rumano unilateral",
      sets: 3,
      reps: "10/lado",
      restSeconds: 60,
      notes: "Balance y cadena posterior",
    },
    {
      name: "Step-ups con peso",
      sets: 3,
      reps: "12/lado",
      restSeconds: 60,
      notes: "Simula subida. Cajón 40-50cm",
    },
    {
      name: "Puente de glúteo con banda",
      sets: 3,
      reps: "15",
      restSeconds: 45,
      notes: "Activación de glúteo medio",
    },
    {
      name: "Plancha lateral",
      sets: 3,
      reps: "30s/lado",
      restSeconds: 30,
      notes: "Core lateral: prevención de lesiones",
    },
    {
      name: "Calf raises (excéntrico)",
      sets: 3,
      reps: "15",
      restSeconds: 45,
      notes: "Lento en la bajada: 3 segundos",
    },
  ],
  basePhaseFrequency: "2x/semana (Martes y Jueves)",
  buildPeakFrequency: "1x/semana (Jueves)",
  taperFrequency: "0 — se elimina completamente",
};

export const PHASE_COLORS = {
  base: {
    bg: "bg-blue-500/20",
    text: "text-blue-400",
    badge: "bg-blue-500/30 text-blue-300",
    border: "border-blue-500/30",
  },
  build: {
    bg: "bg-green-500/20",
    text: "text-green-400",
    badge: "bg-green-500/30 text-green-300",
    border: "border-green-500/30",
  },
  peak: {
    bg: "bg-orange-500/20",
    text: "text-orange-400",
    badge: "bg-orange-500/30 text-orange-300",
    border: "border-orange-500/30",
  },
  taper: {
    bg: "bg-purple-500/20",
    text: "text-purple-400",
    badge: "bg-purple-500/30 text-purple-300",
    border: "border-purple-500/30",
  },
  race: {
    bg: "bg-red-500/20",
    text: "text-red-400",
    badge: "bg-red-500/30 text-red-300",
    border: "border-red-500/30",
  },
  rest: {
    bg: "bg-slate-500/20",
    text: "text-slate-400",
    badge: "bg-slate-500/30 text-slate-300",
    border: "border-slate-500/30",
  },
} as const;

export const SESSION_COLORS = {
  z2: { bg: "bg-sky-500/20", dot: "bg-sky-500" },
  hiit: { bg: "bg-red-500/20", dot: "bg-red-500" },
  long_run: { bg: "bg-amber-500/20", dot: "bg-amber-500" },
  back_to_back: { bg: "bg-teal-500/20", dot: "bg-teal-500" },
  strength: { bg: "bg-indigo-500/20", dot: "bg-indigo-500" },
  rest: { bg: "bg-slate-500/10", dot: "bg-slate-500" },
} as const;
