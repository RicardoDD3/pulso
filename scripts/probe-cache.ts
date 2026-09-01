/**
 * Manual smoke probe (spec doc 05): makes 2 identical LLM calls and checks
 * that the 2nd reports cache_read_tokens > 0. Cache failures don't error —
 * they just bill you — so this is the signal worth watching after changing
 * anything about prompt assembly.
 *
 * Usage: npx tsx scripts/probe-cache.ts [provider/model]
 * Requires the provider's key in .env. NEVER runs in CI.
 */
try {
  process.loadEnvFile(".env");
} catch {
  /* env from shell */
}

async function main() {
  const modelId = process.argv[2] ?? process.env.DEFAULT_CHAT_MODEL ?? "deepseek/deepseek-chat";
  const { streamChat } = await import("@/lib/llm");
  const viewer = { userId: "probe", effectiveUserId: "probe", grant: null };
  // Long, byte-stable system prompt — mirrors the health-context shape.
  const system = `You are a probe. Reply with the single word "ok".\n${"# DATA BLOCK\n".repeat(4000)}`;

  for (const attempt of [1, 2]) {
    let cached = 0;
    let tokensIn = 0;
    for await (const chunk of streamChat({
      feature: "coach",
      viewer,
      model: modelId,
      system,
      messages: [{ role: "user", content: "ping" }],
    })) {
      if (chunk.type === "done") {
        cached = chunk.tokensCached;
        tokensIn = chunk.tokensIn;
      }
      if (chunk.type === "error") throw new Error(chunk.message);
    }
    // eslint-disable-next-line no-console
    console.log(`call ${attempt}: tokensIn=${tokensIn} cached=${cached}`);
    if (attempt === 2) {
      // eslint-disable-next-line no-console
      console.log(
        cached > 0
          ? "✅ provider cache HIT on the 2nd call"
          : "❌ no cache hit — check prompt stability and provider support",
      );
      process.exit(cached > 0 ? 0 : 1);
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
