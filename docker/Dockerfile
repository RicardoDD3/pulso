# Pulso web + worker image (Next.js standalone output, spec doc 01).
FROM node:25-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- worker: runs BullMQ processors (ingestion, PDFs, reconcile) ----
FROM deps AS worker
COPY . .
ENV NODE_ENV=production
CMD ["npx", "tsx", "workers/index.ts"]

# ---- web: standalone Next server; migrations run in the entrypoint ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S pulso && adduser -S pulso -G pulso
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Drizzle migrations + config for the entrypoint migration step
COPY --from=builder /app/lib/db/migrations ./lib/db/migrations
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data/uploads && chown -R pulso:pulso /data /app
USER pulso
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
