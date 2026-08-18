# FMHYchat

FMHYchat is a responsive, FMHY-only discovery interface. Every search result is retrieved from the official [FMHY](https://fmhy.net) database; the application does not supplement answers with third-party search or generated links. Visitors may use search, category browsing, citations, and local browser sessions anonymously.

> **Scope:** This project is intended for legitimate discovery of the resources curated by FMHY. The application preserves FMHY provenance in its source rows and direct links, and returns an honest unavailable state when its grounded resolver cannot complete a request.

## Product and Access Model

Public search has no account requirement. The `/operations` route is intentionally separate from the workspace and uses a dedicated administrator-password session. It has no signup flow and does not rely on Manus OAuth or user roles.

| Surface | Access model | Purpose |
|---|---|---|
| `/` | Anonymous | FMHY-only search, categories, citations, local sessions, retry states |
| `/operations` | Administrator password | Aggregate protection metrics and FMHY search policy controls |
| `/healthz` | Anonymous | Lightweight deployment health response: `{ "status": "ok" }` |

## Local Development

Install dependencies with `pnpm install`, then run `pnpm dev`. The application automatically selects an available port beginning at `3000`. Use `pnpm test` for the regression suite, `pnpm run check` for TypeScript verification, and `pnpm run build` to create the production bundle. Production startup uses `pnpm start`.

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the development server with Vite integration |
| `pnpm test` | Run all unit and component regressions |
| `pnpm run check` | Type-check without emitting files |
| `pnpm run build` | Build client and server production artifacts |
| `pnpm start` | Run the built production server |
| `pnpm audit --prod --audit-level=high` | Review runtime dependency advisories |

## Required Environment

Set production secrets through the hosting environment; do not commit `.env` files. The existing `.gitignore` excludes local environment files. The required active values are listed below.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Recommended | MySQL/TiDB connection used for distributed FMHY protection state and Operations metrics; public search falls back safely when unavailable |
| `FMHY_DATABASE_CA_CERT` | Required with Aiven | Full Aiven project CA certificate PEM used to verify the MySQL TLS server certificate |
| `GROQ_API_KEY` | Yes | Grounded semantic selection for official FMHY content |
| `FMHY_ADMIN_PASSWORD` | Yes | Administrator password accepted only by `/operations` |
| `FMHY_ADMIN_SESSION_SECRET` | Yes | Separate secret used to sign short-lived administrator sessions |
| `PORT` | No | HTTP port assigned by the host; in production the server binds to this exact port on `0.0.0.0` (default: `3000`) |
| `NODE_ENV` | Yes in production | Set to `production` so built static assets are served |

Use a long, unique administrator password and a distinct high-entropy session secret. Rotate both values whenever administrator access may have been exposed. The application uses a secure, `httpOnly`, host-scoped administrator cookie and rate-limits failed password attempts using a privacy-safe client key.

### Aiven MySQL on Render

FMHYchat stores **operational coordination only** in MySQL: rate-limit buckets, queue leases, source-cache metadata, aggregate metrics, a protection policy, and a Groq circuit record. It does not copy the FMHY catalog into the database.

Set `DATABASE_URL` in the Render Web Service to Aiven's MySQL URI, retaining its `ssl-mode=REQUIRED` parameter. Set `FMHY_DATABASE_CA_CERT` to the complete Aiven CA certificate PEM, including its BEGIN and END markers. The runtime converts Aiven's URI hint into strict Node TLS verification and uses this CA rather than accepting an unverified certificate. See [Aiven's TLS guidance](https://aiven.io/docs/platform/concepts/tls-ssl-certificates) for the certificate download location.

The schema must be migrated once before deployment. Use the repository's CA-verified migration runner from a trusted environment with `FMHY_MIGRATION_DATABASE_URL` and `FMHY_DATABASE_CA_CERT` set:

```bash
pnpm tsx scripts/migrate-aiven.mjs
```

Do not put that migration command in Render's Start Command. After migration, retain the normal commands:

```text
Build Command: pnpm install --frozen-lockfile && pnpm run build
Start Command: pnpm start
```

## Release Checklist

Before publishing, confirm that the managed secrets above are configured, then run the test, type-check, build, and production dependency-audit commands. Verify `/healthz`, one anonymous FMHY search, a rejected incorrect Operations password, a successful administrator unlock, policy retrieval, and logout. Review the deployment logs after first traffic; any Groq upstream throttling should appear as the deliberate, user-visible retry state rather than a fabricated result.

The project uses the current root `pnpm-workspace.yaml` for pnpm package overrides and patched dependencies, following the [official pnpm workspace settings guidance](https://pnpm.io/settings#overrides). Keep `pnpm-lock.yaml` committed, install with the repository's declared pnpm version, and avoid broad major-version upgrades immediately before release. Address dependency advisories deliberately with a test-and-build pass rather than relying on an unaudited bulk upgrade.

## Operational Notes

FMHY results are limited to the configured official FMHY page allowlist. Search protection combines privacy-safe per-client limits, global budget controls, a bounded FIFO queue, a short source cache, a MySQL-backed cross-instance coordinator, and a Groq rate-limit circuit breaker. The Operations screen intentionally exposes aggregate protection signals rather than visitor-identifying data.

Historic local answers remain available but may display **Earlier result** when they predate the current resolver contract. Re-running the query obtains a current grounded result.
