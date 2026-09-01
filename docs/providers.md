# Wearable providers: what you get and how to connect

Ingestion goes through your [Open Wearables](https://github.com/the-momentum/open-wearables)
instance. Each cloud provider requires **you** to register a developer app
with the vendor and paste the OAuth credentials into OW — this is the #1
setup pain of any wearable project, so each portal is documented below.

## Coverage matrix (honest — from OW's real capabilities)

| Provider | Daily metrics | Sleep | Workouts | In-workout HR | Power | Notes |
|---|---|---|---|---|---|---|
| Garmin | ✅ steps, RHR, stress, Body Battery, HRV, SpO2 | ✅ full stages + score | ✅ | ✅ | ❌ | Richest daily data; laps/GPS need FIT upload |
| Whoop | ⚠️ no steps | ✅ | ✅ | ✅ | ❌ | Recovery/Strain shown as provider scores; no continuous HR outside workouts |
| Oura | ✅ RHR, HRV, temperature | ✅ full | ⚠️ duration/type/calories only | ❌ | ❌ | Readiness shown as provider score |
| Polar | ✅ | ✅ | ✅ | ✅ | ❌ | Nightly Recharge as provider score |
| Suunto | ✅ | ✅ | ✅ | ✅ | ✅ | |
| Fitbit | ✅ | ⚠️ not via OW today | ✅ | ✅ | ❌ | |
| Strava | ❌ (activity platform) | ❌ | ✅ | ✅ | ✅ | Streams pending OW processing |
| Ultrahuman | ✅ | ✅ | ⚠️ | ❌ | ❌ | |
| Apple Health / Samsung Health / Health Connect | ✅ via OW mobile SDK apps | ✅ | ✅ | varies | ❌ | Needs the OW mobile app; Apple Health XML import also supported |

Cards for metrics a provider doesn't send simply don't appear — no empty
states, no fake zeros. Any watch that exports `.fit` files gets full detail
(laps, route, dynamics, training effect) via per-activity FIT upload.

## Developer portal registration (per provider)

### Garmin
1. Apply at https://developer.garmin.com/gc-developer-program/ (Health API).
   Approval can take days — apply early.
2. Create an app; set the OAuth callback to your OW instance's Garmin callback
   URL (shown in the OW portal provider config).
3. Paste consumer key/secret into OW → Providers → Garmin.

### Whoop
1. https://developer.whoop.com → create an app.
2. Scopes: read:recovery, read:sleep, read:workout, read:profile, read:body_measurement.
3. Callback URL from the OW portal; paste client id/secret into OW.

### Oura
1. https://cloud.ouraring.com/oauth/applications → new application.
2. Callback URL from the OW portal; paste credentials into OW.

### Polar
1. https://admin.polaraccesslink.com → register a client.
2. Callback URL from OW; paste credentials.

### Suunto
1. https://apizone.suunto.com → subscribe to the API, create an app.

### Fitbit
1. https://dev.fitbit.com/apps → register (server type app).

### Strava
1. https://www.strava.com/settings/api → create an app (note the 100 requests
   / 15 min rate limit for personal apps).

### Ultrahuman
1. Contact partner support for API access; configure in OW when issued.

After connecting in **Settings → Wearables**, the initial backfill runs in the
background; "Recent syncs" shows progress and errors per run.
