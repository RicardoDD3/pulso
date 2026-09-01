/**
 * Unified chat store (spec doc 02 §4): one conversations/messages pair for
 * coach | tracking | planner, policies by kind live in code:
 * - tracking: one thread per (user, plan), rolling 24h retention (pruned).
 * - coach / planner: permanent multi-conversation.
 * - model NULL = "follow the instance default" (kills the frozen-default bug).
 * Chats are NEVER visible via grant — every function requires OwnerViewer.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireOwner, type Viewer } from "@/lib/authz/viewer";

const { conversations, messages } = schema;

export type ConversationKind = "coach" | "tracking" | "planner";

export async function listConversations(viewer: Viewer, kind: ConversationKind) {
  const owner = requireOwner(viewer);
  return getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, owner.userId), eq(conversations.kind, kind)))
    .orderBy(desc(conversations.updatedAt));
}

export async function createConversation(
  viewer: Viewer,
  input: { kind: ConversationKind; title?: string; model?: string | null; planId?: string | null },
) {
  const owner = requireOwner(viewer);
  const [row] = await getDb()
    .insert(conversations)
    .values({
      userId: owner.userId,
      kind: input.kind,
      title: input.title ?? null,
      // Only an explicit user choice persists a model; NULL follows the default.
      model: input.model ?? null,
      planId: input.planId ?? null,
    })
    .returning();
  return row;
}

export async function getConversation(viewer: Viewer, id: string) {
  const owner = requireOwner(viewer);
  const [row] = await getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, owner.userId)))
    .limit(1);
  return row ?? null;
}

/** One tracking thread per (user, plan) — created lazily. */
export async function ensureTrackingConversation(viewer: Viewer, planId: string | null) {
  const owner = requireOwner(viewer);
  const db = getDb();
  const planCond = planId
    ? eq(conversations.planId, planId)
    : isNull(conversations.planId);
  const [existing] = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.userId, owner.userId), eq(conversations.kind, "tracking"), planCond),
    )
    .limit(1);
  if (existing) return existing;
  return createConversation(viewer, { kind: "tracking", planId });
}

export async function updateConversation(
  viewer: Viewer,
  id: string,
  patch: Partial<{ title: string; model: string | null }>,
) {
  const owner = requireOwner(viewer);
  const [row] = await getDb()
    .update(conversations)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, owner.userId)))
    .returning();
  return row ?? null;
}

export async function deleteConversation(viewer: Viewer, id: string) {
  const owner = requireOwner(viewer);
  const deleted = await getDb()
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, owner.userId)))
    .returning({ id: conversations.id });
  return deleted.length > 0;
}

export async function listMessages(viewer: Viewer, conversationId: string) {
  const owner = requireOwner(viewer);
  const conversation = await getConversation(owner, conversationId);
  if (!conversation) return null;
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
}

/**
 * saveExchange (ported policy): persist the user+assistant pair ONLY after the
 * stream completes — no orphans when the LLM fails mid-stream; retry doesn't
 * duplicate. Single transaction.
 */
export async function saveExchange(
  viewer: Viewer,
  conversationId: string,
  exchange: {
    userContent: string;
    assistantContent: string;
    model: string;
    action?: string | null;
    tokensIn?: number;
    tokensOut?: number;
  },
) {
  const owner = requireOwner(viewer);
  const conversation = await getConversation(owner, conversationId);
  if (!conversation) return false;
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.insert(messages).values([
      { conversationId, role: "user", content: exchange.userContent },
      {
        conversationId,
        role: "assistant",
        content: exchange.assistantContent,
        model: exchange.model,
        action: exchange.action ?? null,
        tokensIn: exchange.tokensIn ?? null,
        tokensOut: exchange.tokensOut ?? null,
      },
    ]);
    await tx
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  });
  return true;
}

/** Rolling 24h retention for tracking threads (job-pruned, not read-deleted). */
export async function pruneTrackingMessages(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  const result = await db.execute(sql`
    delete from ${messages} using ${conversations}
    where ${messages.conversationId} = ${conversations.id}
      and ${conversations.kind} = 'tracking'
      and ${messages.createdAt} < ${cutoff}
  `);
  return (result as unknown as { count?: number }).count ?? 0;
}
