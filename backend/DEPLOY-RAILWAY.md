# Deploy Precision Rail to Railway

## Critical: Root Directory per service

This repo has **no** package.json at the top level on purpose.
Each Railway service MUST set Root Directory or the build will fail.

| Service | Root Directory | Start command |
|---------|----------------|---------------|
| API | `backend` | `npm start` (auto) |
| Driver | `driver-pwa` | `npm start` (auto) |
| Manager | `manager-web` | `npm start` (auto) |
| Database | PostgreSQL plugin | (none) |

## Build failed? Check these

1. **Root Directory blank** → set to `backend` or `driver-pwa` or `manager-web`
2. **Wrong folder uploaded to GitHub** → repo must show `backend`, `db`, `driver-pwa` at top level
3. **Node version** → each folder has nixpacks.toml forcing Node 20
4. **Watch the build log** → red service → Deployments → View logs

## Variables (API service only)

- DATABASE_URL = reference from Postgres service
- JWT_SECRET = long random string
- NODE_ENV = production
- NOTIFY_PROVIDER = console

## After first successful API deploy

Generate a domain, then load SQL from `db/` into Postgres once.
