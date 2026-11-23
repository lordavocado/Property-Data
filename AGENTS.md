# AGENTS.md

Two projects share this repository:

- **`homeharvest/`**: the Python Realtor.com scraping library (Poetry, `pyproject.toml`, `poetry.lock`). `scrape_listings.py` and `backfill_from_realtor.py` use it to send listings to the API.
- **Dashboard**: a React + Vite frontend in `src/`, an Express + Mongoose API in `server/`, and types shared by both in `shared/` (npm, `package-lock.json`, Node.js version in `.nvmrc`).

## Amp orbs

`.agents/setup` installs Node.js from `.nvmrc`, runs `npm ci`, installs Poetry 2.2.1 and runs `poetry sync`, and runs a local MongoDB 8.0 under systemd at `mongodb://127.0.0.1:27017/homeharvest`. That database starts empty.

`amp orb services ensure` starts the services in `.amp/services.yaml`:

- `api` runs `npm run server` on port 3001. Its health check is `/api/health`.
- `web` runs the Vite dashboard with a portal and proxies `/api` to `api`.

Vite allows any host only when `AMP_ORB` is set (see `vite.config.ts`), so portal hostnames work.

To add test data, POST to the ingest API. It needs no secret unless `INGEST_SECRET` is set:

```sh
curl -X POST localhost:3001/api/ingest/properties -H 'content-type: application/json' \
  -d '{"records":[{"property_id":"test-1","status":"FOR_SALE","list_price":425000,"street":"1 Test Way","city":"Surprise","state":"AZ"}]}'
```

`npm run scrape` loads real data from Realtor.com. `npm run seed:from-supabase` and `POST /api/tag-new-listings` need credentials that are not set up in orbs.

## Checks

- Typecheck: `npx tsc -b`
- Build: `npm run build`
- Lint and format: `poetry run pre-commit run --all-files` (black with line length 120, yamllint, whitespace hooks)
- Tests: `poetry run pytest`

There are no JavaScript lint or test scripts.

The Python tests call the live Realtor.com API, so they are slow (about 5 minutes for all 56) and depend on the network. Long runs often fail with `tenacity.RetryError` wrapping `AuthenticationError ... 403 Forbidden`. That is Realtor.com rate limiting, not a code bug. Rerun the specific tests you touched, for example `poetry run pytest tests/test_realtor.py::test_realtor_pending_or_contingent`, before you conclude that something is broken.
