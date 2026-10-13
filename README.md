# NutriIndia Pro - Web Services prototype (MCA project)

A small Node.js + Express nutrition tracker (register/login, profile, meals, weight, daily calorie/protein summary, goals,
sample Indian foods) that demonstrates 28 web-services checkpoints. REST (`/v1`), GraphQL (`/graphql`), a SOAP/WSDL client demo,
Swagger UI (`/docs`), Jest + Supertest tests, Docker. The JSON REST API is Flutter-friendly (bearer JWT, CORS allow-list).

See **CHECKLIST.md** for the 28-point mapping (file + test command for every requirement).

**Stack:** Node 20 or 22 LTS - Express 4 - SQLite (better-sqlite3) - NeDB (MongoDB-style document store) -
JWT (jsonwebtoken) - AJV - GraphQL (graphql-js) - `soap` - swagger-ui-express - Jest/Supertest.

## 1. Run on Windows (PowerShell)

1. Install Node.js 20 LTS from https://nodejs.org (check: `node -v`).
2. Unzip, then:

```powershell
cd nutriindia-web-services
copy .env.example .env
npm install
npm test
npm start
```

3. Open http://localhost:3000 (app) and http://localhost:3000/docs (Swagger UI).
   Demo logins: `demo@nutriindia.test` / `Demo@1234` (user) and `admin@nutriindia.test` / `Admin@123` (admin) - created only because `SEED_DEMO_DATA=true`.
4. In a second PowerShell window, with the server running: `npm run demo` prints a checkpoint-by-checkpoint walkthrough.

If `npm install` tries to compile `better-sqlite3` and fails, you are on a very new/old Node version: install Node 20 LTS.
A Windows Firewall prompt on first start is normal (allow private networks).

## 2. API examples (PowerShell)

```powershell
$base  = "http://localhost:3000"
$login = Invoke-RestMethod -Method Post "$base/v1/sessions" -ContentType "application/json" -Body '{"email":"demo@nutriindia.test","password":"Demo@1234"}'
$h     = @{ Authorization = "Bearer $($login.accessToken)" }

# Log a meal (Idempotency-Key makes retries safe), then list with cursor pagination
$k = @{ "Idempotency-Key" = "meal-0001" }
Invoke-RestMethod -Method Post "$base/v1/meals" -Headers ($h + $k) -ContentType "application/json" -Body '{"foodId":1,"servings":2,"mealType":"lunch"}'
Invoke-RestMethod "$base/v1/meals?limit=2" -Headers $h        # follow .page.next for the next page

Invoke-RestMethod "$base/v1/summaries/daily" -Headers $h      # calories / protein vs goals
Invoke-RestMethod -Method Put "$base/v1/goals" -Headers $h -ContentType "application/json" -Body '{"dailyCalories":2000,"dailyProteinG":60,"targetWeightKg":70}'
Invoke-RestMethod -Method Post "$base/v1/weights" -Headers $h -ContentType "application/json" -Body '{"weightKg":71.0}'

# GraphQL
Invoke-RestMethod -Method Post "$base/graphql" -ContentType "application/json" -Body '{"query":"{ foods(search:\"dal\"){ name calories proteinG } }"}'

# SOAP (reads the WSDL, calls GetFoodNutrition) and resilience demos
Invoke-RestMethod "$base/v1/external/soap/food-nutrition?name=Idli" -Headers $h
Invoke-RestMethod "$base/v1/external/food-facts?mode=flaky" -Headers $h   # retried -> meta.attempts = 3
```

Headers (use `curl.exe`, not the `curl` alias):

```powershell
curl.exe -i "http://localhost:3000/v1/foods?limit=2"                                   # ETag, Cache-Control, Link, RateLimit-*
curl.exe -i -H "If-None-Match: <paste ETag>" "http://localhost:3000/v1/foods?limit=2"   # 304 Not Modified
curl.exe -i -H "Accept: application/xml" "http://localhost:3000/v1/foods/1"             # XML
curl.exe -i "http://localhost:3000/soap/nutrition?wsdl"                                 # the WSDL
```

`/v1/external/food-facts?mode=` accepts `ok`, `flaky` (fails twice then succeeds), `slow` (timeout -> 504) and `fail` (call 3+ times: the
circuit opens and you get `503 CIRCUIT_OPEN`; it half-opens after `BREAKER_RESET_MS`, default 10 s).

Flutter: use the same endpoints; the Android emulator reaches your PC at `http://10.0.2.2:3000`. Send `Authorization: Bearer <token>`.
Flutter *web* runs on its own origin - add it to `CORS_ORIGINS`.

## 3. Tests

```powershell
npm test                                    # all 55 tests (in-memory databases, no server needed)
npx jest tests/http-features.test.js        # one file
npx jest -t "Idempotency-Key"               # one checkpoint (see CHECKLIST.md)
```

## 4. Docker

```powershell
copy .env.example .env          # then set JWT_SECRET to a long random value
docker compose up --build       # http://localhost:3000   (data kept in the nutri-data volume)
```

All configuration is read from environment variables (twelve-factor); see `.env.example`. With `NODE_ENV=production` the app refuses to start without a real `JWT_SECRET`.

## 5. Make it reachable over the internet

**Option A - temporary public URL (2 minutes, nothing to deploy)**
```powershell
winget install Cloudflare.cloudflared
npm start                                          # window 1
cloudflared tunnel --url http://localhost:3000     # window 2 -> prints https://<random>.trycloudflare.com
```
(ngrok works the same way: `ngrok http 3000`.) Add `TRUST_PROXY=1` to `.env` so rate limiting sees the real client IP. Verify: `$env:BASE_URL="https://<random>.trycloudflare.com"; npm run demo`.

**Option B - permanent host (Render, free tier)**
1. Push this folder to a GitHub repository (`.env` and `data/` are git-ignored).
2. Render dashboard -> **New + -> Blueprint** -> select the repo. `render.yaml` creates a Docker web service, generates `JWT_SECRET`, sets `TRUST_PROXY=1` and health-checks `/health`.
3. After the deploy, open `https://<service>.onrender.com/` and `/docs`; set `CORS_ORIGINS` in the Render dashboard if another site/app calls the API.
4. Check it: `$env:BASE_URL="https://<service>.onrender.com"; npm run demo`.

Free plans sleep when idle and have ephemeral disks, so the SQLite file resets on redeploy (the seed data is recreated at boot). For persistent data attach a disk to `/app/data` or switch the SQL layer to PostgreSQL.

**Option C - any VPS / VM:** install Docker, copy the folder, `docker compose up -d --build`, put Caddy/nginx in front for HTTPS, set `TRUST_PROXY=1`.

## 6. Project layout

```
openapi.yaml            hand-written OpenAPI 3 spec (Swagger UI at /docs)
src/app.js              middleware pipeline + routers (createApp factory, used by server and tests)
src/server.js           process entry point (graceful shutdown)
src/config.js           env-var configuration
src/db.js, seed.js      SQLite schema + sample Indian foods / demo accounts
src/services.js         all SQL (parameterized)
src/nosql.js            NeDB document store (recipes, activity log)
src/schemas.js          AJV schemas
src/graphql.js          GraphQL schema + resolvers
src/soap.js, nutrition.wsdl   mock SOAP service + WSDL-driven SOAP client
src/resilience.js       timeout, retry/backoff, circuit breaker
src/middleware/         correlation, negotiate (JSON/XML, ETag, cache), cors, rateLimit, idempotency, auth, validate, errorHandler
src/routes/             users, foods, meals, tracking, documents, external, mockUpstream
public/                 single-page frontend (login, goals, meals, weight, summary, web-services demo panel)
tests/                  Jest + Supertest
scripts/demo.js         live walkthrough of the checkpoints
```

## Known limits (prototype)
The rate limiter and circuit breakers are in-memory (single instance); SQLite is a single-writer file database; the demo accounts must be disabled (`SEED_DEMO_DATA=false`) in any real deployment.
