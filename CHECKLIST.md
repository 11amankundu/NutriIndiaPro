# Web Services Checklist - 28 checkpoints

Run **everything** with `npm test` (55 tests). Run a single checkpoint with `npx jest -t "<text from the Test column>"`.
Run a live walkthrough with `npm start` then, in a second terminal, `npm run demo`.

| # | Requirement | Implementation | Test / how to verify |
|---|---|---|---|
| 1 | Correct HTTP methods for CRUD | `src/routes/meals.js` (POST create, GET read, PUT replace, PATCH update, DELETE remove); also `foods.js`, `users.js`, `tracking.js` | `npx jest -t "CRUD with correct HTTP methods"` |
| 2 | >= 8 distinct status codes | 200, 201, 204, 304, 400, 401, 403, 404, 406, 409, 415, 422, 429, 500, 502, 503, 504 (all produced by real code paths) | `npx jest -t "at least 8 distinct status codes"` |
| 3 | Consistent error format | `src/middleware/errorHandler.js` -> `{ error: { status, code, message, details?, correlationId } }` | `npx jest -t "uses the same envelope"` |
| 4 | Idempotency key for POST | `src/middleware/idempotency.js` (table `idempotency_keys` in `src/db.js`); used on POST meals/weights/users/foods/recipes | `npx jest -t "Idempotency-Key"` |
| 5 | ETag + 304 | `src/middleware/negotiate.js` (`res.respond`: SHA-1 ETag, `If-None-Match` handling) | `npx jest -t "ETag / 304"` |
| 6 | Cache-Control on GET | `negotiate.js` (default `private, max-age=30`), `routes/foods.js` (`public, max-age=300`), `no-store` for errors/non-GET | `npx jest -t "ETag / 304"` (asserts headers) |
| 7 | AJV JSON Schema validation | `src/schemas.js` (body + query schemas), `src/middleware/validate.js` (422 with per-field details) | `npx jest -t "AJV validation"` |
| 8 | JSON + XML negotiation | `negotiate.js` (`Accept` -> JSON/XML, 406 otherwise), `src/xml.js` | `npx jest -t "Content negotiation"` |
| 9 | Resource-oriented URLs, no verbs | `POST /v1/users` (sign up), `POST /v1/sessions` (log in), `/v1/meals`, `/v1/summaries/daily` ... | `npx jest -t "URL paths contain no verbs"` |
| 10 | Versioning under `/v1` | `src/app.js` mounts all REST routers on `/v1`; unversioned paths return 404 | `npx jest -t "CRUD with correct HTTP methods"` |
| 11 | Cursor pagination with `next` link | `src/pagination.js` (opaque keyset cursor), `services.js` (`listMeals`, `listFoods` ...); `page.next` in body + `Link: rel="next"` header | `npx jest -t "Cursor pagination"` |
| 12 | Rate-limit headers + 429 | `src/middleware/rateLimit.js` (`RateLimit-*`, `X-RateLimit-*`, `Retry-After`) | `npx jest -t "Rate limiting"` |
| 13 | OpenAPI written manually | `openapi.yaml` (hand-written, 21 paths) served at `/openapi.yaml` + `/openapi.json` | `npx jest -t "API documentation"` |
| 14 | Swagger UI served by app | `src/app.js` -> `/docs` (swagger-ui-express) | open http://localhost:3000/docs |
| 15 | GraphQL next to REST | `src/graphql.js` -> `POST /graphql` (queries `foods`, `me`, `meals`, `dailySummary`; mutation `logMeal`) | `npx jest -t "GraphQL alongside REST"` |
| 16 | WSDL read + one SOAP call | `src/nutrition.wsdl`, `src/soap.js` (local mock SOAP service + client that downloads the WSDL, lists operations, calls `GetFoodNutrition`), `GET /v1/external/soap/food-nutrition` | `npx jest -t "SOAP/WSDL client"` |
| 17 | Timeout on every outbound request | `src/resilience.js`: `fetchJson` (`AbortSignal.timeout`) and `withTimeout` (SOAP); `OUTBOUND_TIMEOUT_MS` | `npx jest -t "timeouts"` and `-t "slow upstream"` |
| 18 | Retry with exponential backoff | `resilience.js` `retry` (base x 2^n, jitter, cap); `OUTBOUND_RETRIES`, `OUTBOUND_RETRY_BASE_MS` | `npx jest -t "retry"` |
| 19 | Circuit breaker | `resilience.js` `CircuitBreaker` (CLOSED / OPEN / HALF_OPEN); `GET /v1/external/breaker` | `npx jest -t "circuit breaker"` and `-t "open the breaker"` |
| 20 | Express middleware + central error handling | pipeline in `src/app.js`; `src/middleware/*`; `errorHandler.js` (also hides internals on 500) | `npx jest -t "handled centrally"` |
| 21 | Structured logs + correlation IDs | `src/logger.js` (JSON lines, AsyncLocalStorage), `src/middleware/correlation.js` (`X-Correlation-ID`) | `npx jest -t "Structured logging"` |
| 22 | SQL DB, parameterized queries | `src/db.js` (SQLite schema), `src/services.js` (only `?` / `@name` bindings) | `npx jest -t "SQL database"` (includes injection attempts) |
| 23 | NoSQL document store | `src/nosql.js` (NeDB: MongoDB query language), `routes/documents.js` (`/v1/recipes`, `/v1/activity`) | `npx jest -t "NoSQL document store"` |
| 24 | JWT auth + role-based authorization | `src/middleware/auth.js`, `routes/users.js` (`POST /v1/sessions`); roles `user` / `admin` | `npx jest -t "JWT authentication"` |
| 25 | Deliberate CORS | `src/middleware/cors.js` (allow-list from `CORS_ORIGINS`, explicit methods/headers/exposed headers, no wildcard, no credentials) | `npx jest -t "CORS"` |
| 26 | Jest + Supertest tests | `tests/*.test.js` (4 files, 55 tests) | `npm test` |
| 27 | Docker + twelve-factor config | `Dockerfile`, `docker-compose.yml`, `src/config.js`, `.env.example` (config only from env vars; logs to stdout; fails fast without secret in production) | `docker compose up --build`; `npx jest -t "Twelve-factor"` |
| 28 | Deployable + internet access instructions | `render.yaml`, `/health` endpoint, `TRUST_PROXY`, README section "Make it reachable over the internet" (Cloudflare Tunnel, Render, any Docker host) | `npm run demo` with `BASE_URL` set to the public URL |
