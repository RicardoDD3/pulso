# Security Policy

Pulso stores personal health data. We take every report seriously — with
health data, **an IDOR is always critical**.

## Reporting a vulnerability

Please use **GitHub private vulnerability reporting** (Security → Report a
vulnerability) on this repository. Do not open public issues for security
problems.

- First response SLA: **72 hours**.
- Coordinated disclosure: we'll agree on a timeline with you; fixes ship with
  a regression test (same TDD policy as everything else).

## Supported versions

The latest minor release receives security fixes.

## What counts as a vulnerability

- Any cross-user data access (IDOR, missing scoping, grant bypass).
- Auth bypass, session fixation, CSRF on state-changing endpoints.
- Injection of any kind (SQL, prompt→action escalation in agentic chats).
- Leaking health data into logs or error responses.
- SSRF from user-controlled input.

## Design notes for researchers

Authorization lives in route handlers via the `Viewer` model
(`lib/authz/viewer.ts`) — middleware is UX only. Every repo scopes by
`user_id` in a single place; write repos reject grant viewers at the type
level. See `docs/security-audit-v1.md` for the standing self-audit checklist.
