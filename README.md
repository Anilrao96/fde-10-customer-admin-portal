# FDE Project 10: Customer Admin Portal

A dependency-free Node.js customer administration portal with a browser UI and tenant-scoped API. Owners and admins can manage members and feature access; viewers can inspect their workspace. Every successful change updates a tenant revision and a metadata-only activity trail.

## Run

Requires Node.js 20 or later. Run `npm start`, then open `http://127.0.0.1:3010`. Select a demo persona to explore the portal. `npm run demo` runs a self-contained API walkthrough, and `npm test` covers the high-risk authorization and update rules. State is in memory and resets on restart.

`PORT` changes the listen port. `HOST` defaults to `127.0.0.1`. Demo mode is on by default and exposes local example bearer tokens through `/api/demo-accounts`. For configured tokens, set `PORTAL_DEMO_MODE=0` and `PORTAL_TOKENS_JSON` to a JSON object such as `{"secret-token":{"tenantId":"acme","memberId":"m1"}}`. Keep the JSON value and tokens out of source control and shell history. Demo tokens are disabled and the demo-accounts route returns 404 when demo mode is off. A real deployment needs an external identity provider and TLS; this v1 is designed for local evaluation.

## Workflow

1. Open Acme as owner and add a viewer with a unique email address.
2. Promote or remove a member, or enable a feature. The revision and recent activity update immediately.
3. Switch to Acme viewer. Write controls disappear and API writes return 403.
4. Switch to Northstar owner. Its members, feature settings, revision and activity are separate from Acme.

The API accepts `Authorization: Bearer <token>` on all `/api` routes except the local demo-accounts route. `GET /api/bootstrap` returns the actor, tenant, members, features and eight recent activity entries. `GET /api/audit` returns the tenant's full retained audit and requires an owner or admin. `POST /api/members` creates an admin or viewer; `PATCH /api/members/:id` changes a role; `DELETE /api/members/:id` removes a member; `PATCH /api/features/:name` toggles `analytics`, `exports` or `apiAccess`. Writes take an `expectedVersion` integer from the latest bootstrap response and return 409 on a stale revision. They reject unknown fields and are limited to 16 KiB JSON bodies. `GET /health` is public.

The portal stores bearer tokens only in page memory. API responses and static pages are served with no-store and a restrictive content security policy; UI text is inserted as text, not HTML. See [ARCHITECTURE.md](ARCHITECTURE.md) for trust boundaries, tradeoffs and production upgrades.
