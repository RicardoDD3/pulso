/**
 * Client-side SSE Stream Consumer
 *
 * Port mínimo desde el-consejo (lib/streaming/client.ts): SOLO `consumeStream`,
 * que necesita `coach-stream-store`. El resto del módulo original
 * (fetchWithStreaming y los helpers de servidor de lib/streaming/index.ts) no
 * se porta: cuando las rutas de chat aterricen usarán el AI SDK y este archivo
 * se revisará/retirará.
 */

/** Chunk del protocolo SSE del original (inline; antes vivía en streaming/index). */
export interface StreamChunk {
  type: "delta" | "done" | "error" | "reasoning" | "meta";
  content?: string;
  error?: string;
  data?: Record<string, unknown>; // For metadata like message IDs
}

export interface StreamCallbacks {
  onChunk: (content: string) => void;
  onReasoning?: (content: string) => void;
  onMeta?: (data: Record<string, unknown>) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export interface ConsumeStreamResult {
  content: string;
  error?: string;
  meta?: Record<string, unknown>;
}

/**
 * Consume an SSE stream from a Response object
 *
 * @param response - The fetch Response with SSE stream
 * @param callbacks - Callbacks for handling stream events
 * @param initialTimeoutMs - Timeout for first chunk (0 = no timeout, default 0)
 * @returns Promise that resolves with content and optional error
 */
export async function consumeStream(
  response: Response,
  callbacks: StreamCallbacks,
  initialTimeoutMs: number = 0
): Promise<ConsumeStreamResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    const error = 'No response body';
    console.error("[consumeStream] No response body available");
    callbacks.onError(error);
    return { content: '', error };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let lastMeta: Record<string, unknown> | undefined;
  let receivedFirstChunk = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let chunkCount = 0;

  // Set up initial response timeout (only if timeout > 0)
  const timeoutPromise = initialTimeoutMs > 0
    ? new Promise<{ done: true; value: undefined; timeout: true }>((resolve) => {
      timeoutId = setTimeout(() => {
        if (!receivedFirstChunk) {
          resolve({ done: true, value: undefined, timeout: true });
        }
      }, initialTimeoutMs);
    })
    : null;

  try {
    while (true) {
      // Race between reading and timeout (only before first chunk, and only if timeout is set)
      const readPromise = reader.read();
      const result = receivedFirstChunk || !timeoutPromise
        ? await readPromise
        : await Promise.race([readPromise, timeoutPromise]);

      // Check if it was a timeout
      if ('timeout' in result && result.timeout) {
        reader.cancel();
        const error = `Timeout: sin respuesta después de ${initialTimeoutMs / 1000} segundos`;
        callbacks.onError(error);
        return { content: '', error };
      }

      const { done, value } = result;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          try {
            const chunk: StreamChunk = JSON.parse(data);

            chunkCount++;

            // Clear timeout on any valid chunk from the server
            if (!receivedFirstChunk) {
              receivedFirstChunk = true;
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
            }

            switch (chunk.type) {
              case 'delta':
                if (chunk.content) {
                  fullContent += chunk.content;
                  callbacks.onChunk(chunk.content);
                }
                break;
              case 'reasoning':
                if (chunk.content) {
                  if (callbacks.onReasoning) {
                    callbacks.onReasoning(chunk.content);
                  }
                }
                break;
              case 'meta':
                if (chunk.data) {
                  lastMeta = chunk.data;
                  if (callbacks.onMeta) {
                    callbacks.onMeta(chunk.data);
                  }
                }
                break;
              case 'done':
                callbacks.onDone();
                return { content: fullContent, meta: lastMeta };
              case 'error':
                const error = chunk.error || 'Unknown error';
                if (error !== "terminated") {
                  console.error("[consumeStream] Received error:", error);
                }
                callbacks.onError(error);
                return { content: fullContent, error };
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim().startsWith('data: ')) {
      const data = buffer.trim().slice(6);
      try {
        const chunk: StreamChunk = JSON.parse(data);
        if (chunk.type === 'delta' && chunk.content) {
          fullContent += chunk.content;
          callbacks.onChunk(chunk.content);
        }
      } catch {
        // Skip
      }
    }

    callbacks.onDone();
    return { content: fullContent, meta: lastMeta };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Stream error';
    callbacks.onError(errorMessage);
    return { content: fullContent, error: errorMessage, meta: lastMeta };
  } finally {
    // Clean up timeout if still active
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    reader.releaseLock();
  }
}
