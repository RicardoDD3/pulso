// lib/training ya está portado: la definición canónica de formatPaceMinKm vive
// en lib/training/activity-match.ts (igual que en el origen) y aquí solo se
// re-exporta para los consumidores de lib/health. Sin ciclo: activity-match no
// importa nada.
export { formatPaceMinKm } from "@/lib/training/activity-match";
