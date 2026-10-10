const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const routes = [];
let selected, scoped;
const query = {
  select(value) { selected = value; return this; },
  eq(key, value) { scoped = [key, value]; return this; },
  gte() { return this; }, order() { return this; },
  then(resolve) { return Promise.resolve({ data: [{ id: 'event-a', title: 'QA', event_rsvps: [{ user_id: 'student-a' }, { user_id: 'student-b' }] }], error: null }).then(resolve); }
};
const router = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, ...handlers) => routes.push({ method, path, handler: handlers.at(-1) })]));
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'express') return { Router: () => router };
  if (name === '../services/supabase') return { from: () => query };
  if (name === '../middleware/auth') return { requireAuth() {}, requireRole: () => () => {} };
  return originalLoad.call(this, name, ...args);
};
try { require('../routes/events'); } finally { Module._load = originalLoad; }
test('event list returns count and caller state without leaking RSVP identities', async () => {
  for (const user of ['student-a', 'not-registered']) {
    let body;
    await routes.find(r => r.method === 'get' && r.path === '/').handler({ user: { id: user, collegeId: 'college-a' } }, { json(value) { body = value; } });
    assert.equal(selected, '*, event_rsvps(user_id)');
    assert.deepEqual(scoped, ['college_id', 'college-a']);
    assert.equal(body.events[0].rsvp_count, 2);
    assert.equal(body.events[0].has_rsvpd, user === 'student-a');
    assert.equal(body.events[0].event_rsvps, undefined);
  }
});
