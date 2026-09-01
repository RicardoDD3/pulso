/**
 * Arma el texto que copian los botones "Copiar chat" de los chats de Biohacking
 * (Coach de Biomarcadores, Coach de Tracking y chat "Planes").
 *
 * Es lógica pura a propósito: la UI solo entrega los mensajes y pega el string
 * en el portapapeles.
 */

export interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TranscriptLabels {
  userLabel?: string;
  assistantLabel?: string;
}

const DEFAULT_USER_LABEL = "Yo";
const DEFAULT_ASSISTANT_LABEL = "Coach";

export function formatChatTranscript(
  messages: TranscriptMessage[],
  labels: TranscriptLabels = {}
): string {
  const userLabel = labels.userLabel?.trim() || DEFAULT_USER_LABEL;
  const assistantLabel = labels.assistantLabel?.trim() || DEFAULT_ASSISTANT_LABEL;

  return messages
    .filter((m) => typeof m?.content === "string" && m.content.trim() !== "")
    .map((m) => `${m.role === "user" ? userLabel : assistantLabel}:\n${m.content.trim()}`)
    .join("\n\n");
}
