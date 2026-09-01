import { formatChatTranscript } from "@/lib/utils/chat-transcript";

/**
 * Botón "Copiar chat" de los 3 chats de Biohacking (Coach de Biomarcadores,
 * Coach de Tracking, chat "Planes"): el texto que se manda al portapapeles se
 * arma con esta función pura, para que sea legible fuera de la app (quién dijo
 * qué) y no dependa del DOM.
 */
describe("formatChatTranscript", () => {
  it("etiqueta cada mensaje con quién lo dijo y los separa con una línea en blanco", () => {
    const text = formatChatTranscript(
      [
        { role: "user", content: "¿cómo voy?" },
        { role: "assistant", content: "Vas bien." },
      ],
      { userLabel: "Yo", assistantLabel: "Gemini" }
    );

    expect(text).toBe("Yo:\n¿cómo voy?\n\nGemini:\nVas bien.");
  });

  it("usa etiquetas por defecto cuando no se pasan (o vienen vacías)", () => {
    const text = formatChatTranscript(
      [
        { role: "user", content: "hola" },
        { role: "assistant", content: "hey" },
      ],
      { assistantLabel: "   " }
    );

    expect(text).toBe("Yo:\nhola\n\nCoach:\nhey");
  });

  it("conserva el markdown y los saltos de línea internos del mensaje", () => {
    const content = "## Plan\n\n- lunes: 10 km\n- martes: descanso";
    const text = formatChatTranscript([{ role: "assistant", content }], {
      assistantLabel: "Claude",
    });

    expect(text).toBe(`Claude:\n${content}`);
  });

  it("descarta mensajes vacíos o de puro espacio en blanco", () => {
    const text = formatChatTranscript(
      [
        { role: "user", content: "  " },
        { role: "assistant", content: "" },
        { role: "user", content: " hola " },
      ],
      { userLabel: "Yo" }
    );

    expect(text).toBe("Yo:\nhola");
  });

  it("devuelve cadena vacía si no hay nada que copiar (chat recién abierto)", () => {
    expect(formatChatTranscript([])).toBe("");
    expect(formatChatTranscript([{ role: "user", content: "   " }])).toBe("");
  });
});
