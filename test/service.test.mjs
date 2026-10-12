import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/service.mjs';

async function withService(run, options) {
  const server = createService(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, token, method = 'GET', body) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json() };
  }
  try { await run(request); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('auth, tenant isolation, and viewer restrictions', async () => {
  await withService(async request => {
    assert.equal((await request('/api/bootstrap')).status, 401);
    assert.equal((await request('/api/bootstrap', 'bad-token')).status, 401);
    const acme = await request('/api/bootstrap', 'demo-acme-owner');
    const north = await request('/api/bootstrap', 'demo-north-owner');
    assert.equal(acme.data.tenant.id, 'acme');
    assert.equal(north.data.tenant.id, 'north');
    assert.ok(acme.data.members.every(member => member.email.endsWith('@acme.example')));
    assert.ok(north.data.members.every(member => member.email.endsWith('@north.example')));
    assert.equal((await request('/api/audit', 'demo-acme-viewer')).status, 403);
    assert.equal((await request('/api/features/exports', 'demo-acme-viewer', 'PATCH', { enabled: true, expectedVersion: 1 })).status, 403);
    assert.equal((await request('/api/demo-accounts')).status, 200);
  });
});

test('version conflicts, owner protections, and tenant-scoped audit', async () => {
  await withService(async request => {
    const created = await request('/api/members', 'demo-acme-admin', 'POST', {
      name: 'Dana New', email: 'dana@acme.example', role: 'viewer', expectedVersion: 1
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.tenant.version, 2);
    const newMember = created.data.members.find(member => member.email === 'dana@acme.example');
    assert.ok(newMember);
    assert.equal((await request('/api/members', 'demo-acme-admin', 'POST', {
      name: 'Second', email: 'second@acme.example', role: 'viewer', expectedVersion: 1
    })).status, 409);
    assert.equal((await request('/api/members/m1', 'demo-acme-admin', 'DELETE', { expectedVersion: 2 })).status, 403);
    assert.equal((await request('/api/members/m1', 'demo-acme-owner', 'DELETE', { expectedVersion: 2 })).status, 403);
    assert.equal((await request(`/api/members/${newMember.id}`, 'demo-acme-admin', 'PATCH', {
      role: 'owner', expectedVersion: 2
    })).status, 403);
    const changed = await request('/api/features/exports', 'demo-acme-admin', 'PATCH', { enabled: true, expectedVersion: 2 });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.features.exports, true);
    assert.deepEqual(changed.data.recentActivity.map(event => event.action), ['feature.changed', 'member.created']);
    const north = await request('/api/bootstrap', 'demo-north-owner');
    assert.equal(north.data.tenant.version, 1);
    assert.deepEqual(north.data.recentActivity, []);
  });
});

test('rejects invalid writes and disables demo tokens outside demo mode', async () => {
  await withService(async request => {
    const bad = await request('/api/members', 'demo-acme-owner', 'POST', {
      name: 'Eve', email: 'eve@acme.example', role: 'owner', expectedVersion: 1
    });
    assert.equal(bad.status, 400);
    assert.equal((await request('/api/members', 'demo-acme-owner', 'POST', {
      name: 'Eve', email: 'eve@acme.example', role: 'viewer', expectedVersion: 1, tenantId: 'north'
    })).status, 400);
    assert.equal((await request('/api/bootstrap', 'demo-acme-owner')).data.tenant.version, 1);
  });
  await withService(async request => {
    assert.equal((await request('/api/demo-accounts')).status, 404);
    assert.equal((await request('/api/bootstrap', 'demo-acme-owner')).status, 401);
    assert.equal((await request('/api/bootstrap', 'operator-acme')).data.tenant.id, 'acme');
  }, { demoMode: false, tokens: { 'operator-acme': { tenantId: 'acme', memberId: 'm1' } } });
});
