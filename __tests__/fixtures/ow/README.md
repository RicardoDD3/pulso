# Open Wearables fixtures

Sample OW API responses used by the ingestion contract tests
(`__tests__/ow/`). They are **hand-derived from the OW backend source**
(`the-momentum/open-wearables` @ `main`, September 2026 — pydantic schemas
under `backend/app/schemas/`), NOT recorded from a live server.

OW is pre-1.0 and its API may change. When bumping the pinned OW image digest
(docker-compose), re-record these fixtures against a real OW instance and
re-run the contract tests before merging (spec doc 03, isolation contract).

| Fixture | Endpoint | Grounding |
|---|---|---|
| `user.json` | `GET/POST /api/v1/users` | `user_management/user.py`, `utils/pagination.py` |
| `connections.json` | `GET /api/v1/users/{id}/connections` | `user_management/user_connection.py` |
| `events-workout.json` | `GET /api/v1/users/{id}/events/workouts` | `responses/activity/events.py` |
| `events-sleep.json` | `GET /api/v1/users/{id}/events/sleep` | `responses/activity/events.py` |
| `timeseries.json` | `GET /api/v1/users/{id}/timeseries` | `responses/activity/data_point_responses.py` |
| `daily-summaries.json` | `GET /api/v1/users/{id}/summaries/*` | `responses/activity/summaries.py` |
| `health-scores.json` | `GET /api/v1/users/{id}/health-scores` | `model_crud/activities/health_score.py` |
| `webhook-event.json` | webhook deliveries | `services/outgoing_webhooks/events.py` |
