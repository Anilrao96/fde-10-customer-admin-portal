# Architecture

```text
Browser UI -> bearer-token API -> identity lookup -> tenant state
                                    -> role checks -> versioned write -> audit
```

The service is one Node.js process with no runtime dependencies. It serves the static portal and an HTTP JSON API. Two seeded tenants make isolation visible in the demo. Each bearer token maps to a tenant and member id; tenant scope comes from that mapping, never from a request field. The server looks up the member on every request, so removing a member immediately removes their access. Owner, admin and viewer permissions are checked server-side. Admins cannot manage owners; members cannot change their own membership. A tenant must retain an owner.

Writes use a tenant revision as an optimistic concurrency check. The version check and mutation are synchronous within one Node event loop turn, so two requests in this single process cannot both write the same revision. This does not cover multiple processes or durable storage. The service records the last 100 metadata-only audit entries per tenant and returns the latest eight in bootstrap. Audit entries contain actor id, action, target, timestamp and relevant role/feature metadata; they omit email addresses and bearer tokens. Unexpected request failures are logged without request bodies or authorization headers.

## Security and limitations

The default listen address is loopback. Demo mode publishes known tokens and should only be used locally. Configured tokens are static operator-provided credentials, not password login or an identity provider. The browser keeps a token in memory until navigation, but browser extensions and compromised page scripts remain a threat. Static assets have a restrictive content security policy, no-store caching, and no dynamic HTML injection. The API requires bearer tokens for reads and writes, avoiding ambient cookie credentials; TLS is required before any network deployment.

The entire state, revisions and audit disappear on restart. Seeded members and features are illustrative. There are no invitations, email verification, sessions, token rotation, per-tenant quotas, rate limits or durable audit guarantees. Health only checks process availability. The bounded audit and request body size limit memory use per operation, but member count and total tenants are not bounded for sustained operation.

## Production path

Use an identity provider with short-lived, tenant-scoped sessions and invite acceptance. Persist memberships, feature settings and audit events in a database with tenant keys, unique email constraints, transactions and version checks. Enforce at least one owner in the same transaction as role updates. Add rate limits, quotas, CSRF protection if switching to cookie sessions, and TLS at a trusted proxy. Emit request latency, authorization failures, revision conflicts and tenant-scoped change counters to an observability backend; keep tokens, names and email addresses out of logs. Add a durable append-only audit sink, retention controls and backup/restore procedures. Review accessible keyboard behavior and responsive layouts before broad deployment.
