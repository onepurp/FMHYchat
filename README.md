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
| `DATABASE_URL` | Yes | MySQL/TiDB connection used for distributed FMHY protection state and Operations metrics |
| `GROQ_API_KEY` | Yes | Grounded semantic selection for official FMHY content |
| `FMHY_ADMIN_PASSWORD` | Yes | Administrator password accepted only by `/operations` |
| `FMHY_ADMIN_SESSION_SECRET` | Yes | Separate secret used to sign short-lived administrator sessions |
| `PORT` | No | Preferred HTTP port; the server selects the next available port if needed |
| `NODE_ENV` | Yes in production | Set to `production` so built static assets are served |

Use a long, unique administrator password and a distinct high-entropy session secret. Rotate both values whenever administrator access may have been exposed. The application uses a secure, `httpOnly`, host-scoped administrator cookie and rate-limits failed password attempts using a privacy-safe client key.

## Release Checklist

Before publishing, confirm that the managed secrets above are configured, then run the test, type-check, build, and production dependency-audit commands. Verify `/healthz`, one anonymous FMHY search, a rejected incorrect Operations password, a successful administrator unlock, policy retrieval, and logout. Review the deployment logs after first traffic; any Groq upstream throttling should appear as the deliberate, user-visible retry state rather than a fabricated result.

The project uses the current root `pnpm-workspace.yaml` for pnpm package overrides and patched dependencies, following the [official pnpm workspace settings guidance](https://pnpm.io/settings#overrides). Keep `pnpm-lock.yaml` committed, install with the repository's declared pnpm version, and avoid broad major-version upgrades immediately before release. Address dependency advisories deliberately with a test-and-build pass rather than relying on an unaudited bulk upgrade.

## Operational Notes

FMHY results are limited to the configured official FMHY page allowlist. Search protection combines privacy-safe per-client limits, global budget controls, a bounded FIFO queue, a short source cache, a MySQL-backed cross-instance coordinator, and a Groq rate-limit circuit breaker. The Operations screen intentionally exposes aggregate protection signals rather than visitor-identifying data.

Historic local answers remain available but may display **Earlier result** when they predate the current resolver contract. Re-running the query obtains a current grounded result.
