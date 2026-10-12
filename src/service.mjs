import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const webRoot = new URL('../web/', import.meta.url);
const allowedRoles = new Set(['owner', 'admin', 'viewer']);
const allowedFeatures = new Set(['analytics', 'exports', 'apiAccess']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createService({ demoMode = true, tokens, now = () => new Date().toISOString() } = {}) {
  const tenants = new Map([
    ['acme', {
      name: 'Acme Labs', version: 1, nextMember: 4,
      members: [
        { id: 'm1', name: 'Ava Owner', email: 'ava@acme.example', role: 'owner' },
        { id: 'm2', name: 'Ben Admin', email: 'ben@acme.example', role: 'admin' },
        { id: 'm3', name: 'Cora Viewer', email: 'cora@acme.example', role: 'viewer' }
      ],
      features: { analytics: true, exports: false, apiAccess: true }, audit: []
    }],
    ['north', {
      name: 'Northstar Co', version: 1, nextMember: 3,
      members: [
        { id: 'm1', name: 'Noor Owner', email: 'noor@north.example', role: 'owner' },
        { id: 'm2', name: 'Nico Viewer', email: 'nico@north.example', role: 'viewer' }
      ],
      features: { analytics: false, exports: true, apiAccess: false }, audit: []
    }]
  ]);
  const demoAccounts = [
    { label: 'Acme owner', token: 'demo-acme-owner', tenantId: 'acme', memberId: 'm1' },
    { label: 'Acme admin', token: 'demo-acme-admin', tenantId: 'acme', memberId: 'm2' },
    { label: 'Acme viewer', token: 'demo-acme-viewer', tenantId: 'acme', memberId: 'm3' },
    { label: 'Northstar owner', token: 'demo-north-owner', tenantId: 'north', memberId: 'm1' }
  ];
  const credentials = new Map();
  if (demoMode) for (const account of demoAccounts) credentials.set(account.token, account);
  if (tokens) {
    for (const [token, identity] of Object.entries(tokens)) {
      if (!token || !identity || typeof identity.tenantId !== 'string' || typeof identity.memberId !== 'string') {
        throw new Error('Invalid PORTAL_TOKENS_JSON entry');
      }
      credentials.set(token, identity);
    }
  }

  function send(res, status, data, extra = {}) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra
    });
    res.end(JSON.stringify(data));
  }
  function fail(res, status, code, message) { send(res, status, { error: { code, message } }); }
  async function body(req) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 16_384) {
        const error = new Error('Request body exceeds 16 KiB');
        error.status = 413;
        throw error;
      }
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
      return parsed;
    } catch { const error = new Error('Expected a JSON object'); error.status = 400; throw error; }
  }
  function actorFor(req) {
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization || '');
    const identity = match && credentials.get(match[1]);
    const tenant = identity && tenants.get(identity.tenantId);
    const actor = tenant?.members.find(member => member.id === identity.memberId);
    return actor ? { tenantId: identity.tenantId, tenant, actor } : null;
  }
  function record(ctx, action, target, detail = {}) {
    ctx.tenant.audit.unshift({ at: now(), actorId: ctx.actor.id, action, target, ...detail });
    ctx.tenant.audit.length = Math.min(ctx.tenant.audit.length, 100);
  }
  function snapshot(ctx) {
    return {
      tenant: { id: ctx.tenantId, name: ctx.tenant.name, version: ctx.tenant.version },
      actor: ctx.actor,
      members: ctx.tenant.members,
      features: ctx.tenant.features,
      recentActivity: ctx.tenant.audit.slice(0, 8)
    };
  }
  function canManage(ctx) { return ctx.actor.role === 'owner' || ctx.actor.role === 'admin'; }
  function checkVersion(res, input, tenant) {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      fail(res, 400, 'INVALID_VERSION', 'expectedVersion must be a positive integer');
      return false;
    }
    if (input.expectedVersion !== tenant.version) {
      fail(res, 409, 'VERSION_CONFLICT', 'Data changed; refresh and retry');
      return false;
    }
    return true;
  }
  function validKeys(value, keys) { return Object.keys(value).every(key => keys.includes(key)); }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok' });
      if (req.method === 'GET' && url.pathname === '/api/demo-accounts') {
        return demoMode ? send(res, 200, { accounts: demoAccounts }) : fail(res, 404, 'NOT_FOUND', 'Not found');
      }
      if (req.method === 'GET' && ['/', '/app.js', '/styles.css'].includes(url.pathname)) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.js') ? 'text/javascript' : 'text/css';
        res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
        return res.end(await readFile(new URL(name, webRoot)));
      }
      if (!url.pathname.startsWith('/api/')) return fail(res, 404, 'NOT_FOUND', 'Not found');
      const ctx = actorFor(req);
      if (!ctx) return fail(res, 401, 'UNAUTHORIZED', 'Valid bearer token required');
      if (req.method === 'GET' && url.pathname === '/api/bootstrap') return send(res, 200, snapshot(ctx));
      if (req.method === 'GET' && url.pathname === '/api/audit') {
        if (!canManage(ctx)) return fail(res, 403, 'FORBIDDEN', 'Manager role required');
        return send(res, 200, { entries: ctx.tenant.audit });
      }
      if (req.method === 'POST' && url.pathname === '/api/members') {
        if (!canManage(ctx)) return fail(res, 403, 'FORBIDDEN', 'Manager role required');
        const input = await body(req);
        if (!validKeys(input, ['name', 'email', 'role', 'expectedVersion'])) return fail(res, 400, 'INVALID_FIELDS', 'Unknown field');
        if (!checkVersion(res, input, ctx.tenant)) return;
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (!name || name.length > 80 || !emailPattern.test(email) || email.length > 254 || !['admin', 'viewer'].includes(input.role)) {
          return fail(res, 400, 'INVALID_MEMBER', 'Provide a name, email, and admin or viewer role');
        }
        if (ctx.tenant.members.some(member => member.email === email)) return fail(res, 409, 'DUPLICATE_EMAIL', 'Email already exists in tenant');
        const member = { id: `m${ctx.tenant.nextMember++}`, name, email, role: input.role };
        ctx.tenant.members.push(member); ctx.tenant.version++;
        record(ctx, 'member.created', member.id, { role: member.role });
        return send(res, 201, snapshot(ctx));
      }
      const memberMatch = /^\/api\/members\/(m\d+)$/.exec(url.pathname);
      if (memberMatch && ['PATCH', 'DELETE'].includes(req.method)) {
        if (!canManage(ctx)) return fail(res, 403, 'FORBIDDEN', 'Manager role required');
        const input = await body(req);
        if (!validKeys(input, req.method === 'PATCH' ? ['role', 'expectedVersion'] : ['expectedVersion'])) return fail(res, 400, 'INVALID_FIELDS', 'Unknown field');
        if (!checkVersion(res, input, ctx.tenant)) return;
        const member = ctx.tenant.members.find(item => item.id === memberMatch[1]);
        if (!member) return fail(res, 404, 'NOT_FOUND', 'Member not found');
        if (member.id === ctx.actor.id) return fail(res, 403, 'SELF_MANAGEMENT', 'Cannot change your own membership');
        if (member.role === 'owner' && ctx.actor.role !== 'owner') return fail(res, 403, 'FORBIDDEN', 'Only an owner can manage owners');
        if (req.method === 'DELETE') {
          if (member.role === 'owner' && ctx.tenant.members.filter(item => item.role === 'owner').length === 1) {
            return fail(res, 409, 'LAST_OWNER', 'Tenant must retain an owner');
          }
          ctx.tenant.members.splice(ctx.tenant.members.indexOf(member), 1); ctx.tenant.version++;
          record(ctx, 'member.removed', member.id, { role: member.role });
          return send(res, 200, snapshot(ctx));
        }
        if (!allowedRoles.has(input.role)) return fail(res, 400, 'INVALID_ROLE', 'Unknown role');
        if (input.role === 'owner' && ctx.actor.role !== 'owner') return fail(res, 403, 'FORBIDDEN', 'Only an owner can assign owner');
        if (member.role === 'owner' && input.role !== 'owner' && ctx.tenant.members.filter(item => item.role === 'owner').length === 1) {
          return fail(res, 409, 'LAST_OWNER', 'Tenant must retain an owner');
        }
        if (member.role !== input.role) {
          const previousRole = member.role;
          member.role = input.role; ctx.tenant.version++;
          record(ctx, 'member.role_changed', member.id, { from: previousRole, to: input.role });
        }
        return send(res, 200, snapshot(ctx));
      }
      const featureMatch = /^\/api\/features\/([a-zA-Z]+)$/.exec(url.pathname);
      if (req.method === 'PATCH' && featureMatch) {
        if (!canManage(ctx)) return fail(res, 403, 'FORBIDDEN', 'Manager role required');
        const input = await body(req);
        if (!validKeys(input, ['enabled', 'expectedVersion'])) return fail(res, 400, 'INVALID_FIELDS', 'Unknown field');
        if (!checkVersion(res, input, ctx.tenant)) return;
        if (!allowedFeatures.has(featureMatch[1]) || typeof input.enabled !== 'boolean') return fail(res, 400, 'INVALID_FEATURE', 'Unknown feature or enabled value');
        if (ctx.tenant.features[featureMatch[1]] !== input.enabled) {
          ctx.tenant.features[featureMatch[1]] = input.enabled; ctx.tenant.version++;
          record(ctx, 'feature.changed', featureMatch[1], { enabled: input.enabled });
        }
        return send(res, 200, snapshot(ctx));
      }
      return fail(res, 404, 'NOT_FOUND', 'Not found');
    } catch (error) {
      if (error.status) return fail(res, error.status, 'BAD_REQUEST', error.message);
      console.error('request_failed', { path: url.pathname, message: error.message });
      return fail(res, 500, 'INTERNAL_ERROR', 'Unexpected error');
    }
  });
  return server;
}
