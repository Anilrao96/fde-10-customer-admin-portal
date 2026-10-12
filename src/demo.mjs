import assert from 'node:assert/strict';
import { createService } from './service.mjs';

const server = createService({ now: () => '2026-01-01T00:00:00.000Z' });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function call(path, token, method = 'GET', body) {
  const response = await fetch(base + path, {
    method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}
try {
  const owner = 'demo-acme-owner';
  const viewer = 'demo-acme-viewer';
  const initial = await call('/api/bootstrap', owner);
  console.log(`Opened ${initial.data.tenant.name} as ${initial.data.actor.role}; revision ${initial.data.tenant.version}`);
  const denied = await call('/api/features/exports', viewer, 'PATCH', { enabled: true, expectedVersion: 1 });
  assert.equal(denied.status, 403);
  console.log('Viewer configuration change denied');
  const added = await call('/api/members', owner, 'POST', { name: 'Dina Demo', email: 'dina@acme.example', role: 'viewer', expectedVersion: 1 });
  assert.equal(added.status, 201);
  console.log(`Added member; revision ${added.data.tenant.version}`);
  const stale = await call('/api/features/exports', owner, 'PATCH', { enabled: true, expectedVersion: 1 });
  assert.equal(stale.status, 409);
  console.log('Stale configuration change rejected');
  const feature = await call('/api/features/exports', owner, 'PATCH', { enabled: true, expectedVersion: 2 });
  assert.equal(feature.status, 200);
  const otherTenant = await call('/api/bootstrap', 'demo-north-owner');
  assert.equal(otherTenant.data.features.exports, true);
  assert.equal(otherTenant.data.tenant.version, 1);
  assert.equal(otherTenant.data.members.length, 2);
  console.log('Acme feature enabled; Northstar membership and revision unchanged');
  console.log(`Audit: ${feature.data.recentActivity.map(event => event.action).join(', ')}`);
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
