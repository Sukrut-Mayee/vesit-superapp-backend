const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Execute the real route handlers with an isolated database boundary: no live data.
const routes = [];
let listing, updates, filters;
const query = {
  select() { return this; }, order() { return this; },
  eq(key, value) { filters.push([key, value]); return this; },
  update(values) { updates.push(values); return this; },
  single: async () => ({ data: listing, error: null }),
  then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
};
const router = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method =>
  [method, (path, ...handlers) => routes.push({ method, path, handler: handlers.at(-1) })]));
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'express') return { Router: () => router };
  if (name === 'multer') return Object.assign(() => ({ single: () => () => {} }), { memoryStorage: () => ({}) });
  if (name === '../services/supabase') return { from: () => query };
  if (name === '../services/cloudinary') return {};
  if (name === '../middleware/auth') return { requireAuth() {}, requireRole: () => () => {} };
  return originalLoad.call(this, name, ...args);
};
try { require('../routes/lost-found'); } finally { Module._load = originalLoad; }

async function resolveAs(id, role = 'student', college = 'college-a') {
  updates = []; filters = [];
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  // Simulate the tenant-filtered row lookup, as Postgres would.
  if (listing && listing.college_id !== college) listing = null;
  await routes.find(r => r.method === 'patch').handler({ params: { id: 'listing-a' }, user: { id, role, collegeId: college } }, response);
  return response;
}

for (const type of ['lost', 'found']) {
  test(`${type}: only poster resolves, including admins`, async () => {
    listing = { id: 'listing-a', poster_id: 'poster', college_id: 'college-a', type, status: 'open' };
    assert.equal((await resolveAs('other')).code, 403);
    assert.deepEqual(updates, []);
    assert.equal((await resolveAs('admin', 'admin')).code, 403);
    assert.deepEqual(updates, []);
    assert.equal((await resolveAs('poster')).code, 200);
    assert.deepEqual(updates, [{ status: 'resolved' }]);
    assert.ok(filters.some(([key, value]) => key === 'poster_id' && value === 'poster'));
  });
}
test('cross-college row cannot be resolved', async () => {
  listing = { poster_id: 'poster', college_id: 'college-a', status: 'open' };
  assert.equal((await resolveAs('poster', 'student', 'college-b')).code, 404);
  assert.deepEqual(updates, []);
});
test('repeated resolution by poster is idempotent', async () => {
  listing = { poster_id: 'poster', college_id: 'college-a', status: 'resolved' };
  assert.equal((await resolveAs('poster')).code, 200);
  assert.deepEqual(updates, []);
});
test('status filters preserve open default and support history', async () => {
  for (const status of [undefined, 'all', 'resolved', 'invalid']) {
    filters = [];
    const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await routes.find(r => r.method === 'get').handler({ query: { status }, user: { collegeId: 'college-a' } }, response);
    assert.equal(response.code, status === 'invalid' ? 400 : 200);
    if (status === 'all') assert.ok(!filters.some(([key]) => key === 'status'));
    if (!status || status === 'resolved') assert.ok(filters.some(([key, value]) => key === 'status' && value === (status || 'open')));
  }
});
