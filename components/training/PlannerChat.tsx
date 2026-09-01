"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Message = { id: string; role: "user" | "assistant"; content: string };

type Chunk = {
  type: string;
  text?: string;
  message?: string;
  data?: { planModified?: boolean };
};

async function readSse(res: Response, onChunk: (chunk: Chunk) => void) {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const line = event.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onChunk(JSON.parse(line.slice(6)));
      } catch {
        /* partial frame */
      }
    }
  }
}

type Props = {
  planId: string;
  onPlanModified: () => void;
  onClose: () => void;
};

/** Side-panel agentic editor over /api/training/planner/chat (spec doc 09). */
export function PlannerChat({ planId, onPlanModified, onClose }: Props) {
  const t = useTranslations("training.chat");
  const tCommon = useTranslations("common");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  async function send() {
    if (!input.trim() || streaming) return;
    setError(null);
    setStreaming(true);
    const userText = input;
    setInput("");
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: userText }]);
    setDraft("");
    try {
      let convId = conversationId;
      if (!convId) {
        const res = await fetch("/api/coach/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "planner", planId }),
        });
        if (!res.ok) throw new Error();
        convId = (await res.json()).conversation.id as string;
        setConversationId(convId);
      }

      const res = await fetch("/api/training/planner/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, planId, message: userText }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? tCommon("error"));
        return;
      }

      let acc = "";
      let modified = false;
      await readSse(res, (chunk) => {
        if (chunk.type === "delta" && chunk.text) {
          acc += chunk.text;
          setDraft(acc);
        } else if (chunk.type === "meta" && chunk.data?.planModified) {
          modified = true;
        } else if (chunk.type === "error") {
          setError(chunk.message ?? tCommon("error"));
        } else if (chunk.type === "done") {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", content: chunk.text ?? acc },
          ]);
          setDraft("");
        }
      });
      if (modified) onPlanModified();
    } catch {
      setError(tCommon("error"));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <aside className="flex w-full flex-col rounded-xl border border-zinc-800 bg-zinc-900 lg:w-80 lg:shrink-0">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <button
          onClick={onClose}
          aria-label={tCommon("cancel")}
          className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800"
        >
          ✕
        </button>
      </div>
      <div className="min-h-64 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && !draft ? (
          <p className="text-xs text-zinc-500">{t("empty")}</p>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === "user" ? "ml-auto bg-emerald-900/50" : "bg-zinc-800"
            }`}
          >
            {m.content}
          </div>
        ))}
        {draft ? (
          <div className="max-w-[90%] rounded-xl bg-zinc-800 px-3 py-2 text-sm whitespace-pre-wrap">
            {draft}
            <span className="animate-pulse">▌</span>
          </div>
        ) : null}
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex gap-2 border-t border-zinc-800 p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("placeholder")}
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40"
        >
          {t("send")}
        </button>
      </form>
    </aside>
  );
}
