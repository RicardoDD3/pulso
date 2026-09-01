# Your privacy

Pulso is self-hosted: your data lives in **your** Postgres, on **your** server.

## What goes where

| Data | Where it lives | Ever leaves your server? |
|---|---|---|
| Wearable data | Your Postgres (`pulso` DB) + your OW instance | No |
| Lab PDFs | `uploads` volume on your server | Only to the vision LLM **you** configure, when you upload one |
| Chat messages | Your Postgres | Only to the chat LLM **you** configure, when you chat |
| Health context (the coach prompt) | Built on demand from your DB | Sent to your configured LLM with each chat message |
| Credentials | Better Auth tables in your Postgres (hashed) | No |

- **Zero telemetry.** Pulso phones home to no one. Not even opt-in.
- Sentry error reporting activates only if YOU set `SENTRY_DSN`.
- Weather enrichment calls Open-Meteo with workout coordinates (no key, no
  account). Remove nothing else identifies you.

## Logging policy

Server logs contain ids and counts — never chat content, lab values or health
metrics. This is enforced by review and by the logger's redaction config.

## Export & deletion

- **Export**: Settings → "Export my data" → ZIP with one JSON per table plus
  your original lab PDFs.
- **Delete**: Settings → danger zone. Deletes the OW-side user (tokens +
  provider data), your uploaded files, and the local user row — every data
  table has `ON DELETE CASCADE`, so deletion is enforced by the database, not
  by application code.

## AI features

The coach and lab extraction send data to the LLM provider configured by the
instance admin (`DEFAULT_CHAT_MODEL`, `VISION_MODEL`). For a fully private
setup, use Ollama or any OpenAI-compatible local endpoint — then nothing
leaves your machines at all.
