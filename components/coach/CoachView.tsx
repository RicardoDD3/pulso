"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Conversation = {
  id: string;
  title: string | null;
  model: string | null;
  updatedAt: string;
};

type Message = {
  id: number | string;
  role: "user" | "assistant" | "system";
  content: string;
};

async function readSse(
  res: Response,
  onChunk: (chunk: { type: string; text?: string; message?: string }) => void,
) {
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

export function CoachView() {
  const t = useTranslations("coach");
  const tCommon = useTranslations("common");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/coach/conversations?kind=coach");
    if (res.ok) {
      const json = await res.json();
      setConversations(json.conversations);
      return json.conversations as Conversation[];
    }
    return [];
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    fetch(`/api/coach/conversations/${activeId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => setMessages(json.messages))
      .catch(() => setError(tCommon("error")));
  }, [activeId, tCommon]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  async function newConversation() {
    const res = await fetch("/api/coach/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "coach" }),
    });
    if (res.ok) {
      const { conversation } = await res.json();
      await loadConversations();
      setActiveId(conversation.id);
    }
  }

  async function send() {
    if (!input.trim() || streaming) return;
    let conversationId = activeId;
    if (!conversationId) {
      const res = await fetch("/api/coach/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "coach", title: input.slice(0, 60) }),
      });
      if (!res.ok) return;
      conversationId = (await res.json()).conversation.id as string;
      setActiveId(conversationId);
      await loadConversations();
    }
    const userText = input;
    setInput("");
    setError(null);
    setStreaming(true);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: userText }]);
    setDraft("");
    try {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: userText }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? tCommon("error"));
        setStreaming(false);
        return;
      }
      let acc = "";
      await readSse(res, (chunk) => {
        if (chunk.type === "delta" && chunk.text) {
          acc += chunk.text;
          setDraft(acc);
        } else if (chunk.type === "error") {
          setError(chunk.message ?? tCommon("error"));
        } else if (chunk.type === "done") {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", content: acc },
          ]);
          setDraft("");
        }
      });
    } catch {
      setError(tCommon("error"));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside className="hidden w-60 shrink-0 flex-col gap-2 sm:flex">
        <button
          onClick={newConversation}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold hover:bg-emerald-500"
        >
          {t("newChat")}
        </button>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm ${
                c.id === activeId ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              {c.title ?? t("untitled")}
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && !draft ? (
            <p className="text-sm text-zinc-500">{t("emptyState")}</p>
          ) : null}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "ml-auto bg-emerald-900/50" : "bg-zinc-800"
              }`}
            >
              {m.content}
            </div>
          ))}
          {draft ? (
            <div className="max-w-[85%] rounded-xl bg-zinc-800 px-3.5 py-2.5 text-sm whitespace-pre-wrap">
              {draft}
              <span className="animate-pulse">▌</span>
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div ref={bottomRef} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex gap-2 border-t border-zinc-800 p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("placeholder")}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40"
          >
            {t("send")}
          </button>
        </form>
      </section>
    </div>
  );
}
