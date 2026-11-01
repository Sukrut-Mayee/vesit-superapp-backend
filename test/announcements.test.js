const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
}

// ---------------------------------------------------------------------------
// Mock Supabase Setup for Announcements API Testing
// ---------------------------------------------------------------------------
let mockAnnouncements = [];
let mockDbError = null;

const createMockSupabase = () => ({
  from: (table) => {
    let filters = [];
    let rangeLimits = null;

    const builder = {
      select: () => builder,
      eq: (field, val) => {
        filters.push({ type: 'eq', field, val });
        return builder;
      },
      order: () => builder,
      range: (from, to) => {
        rangeLimits = { from, to };
        return builder;
      },
      insert: (record) => {
        const newRecord = {
          id: '11111111-1111-4111-8111-111111111111',
          created_at: new Date().toISOString(),
          ...record
        };
        mockAnnouncements.push(newRecord);
        return {
          select: () => ({
            single: async () => {
              if (mockDbError) throw mockDbError;
              return { data: newRecord, error: null };
            }
          })
        };
      },
      update: (updates) => ({
        eq: (f1, v1) => ({
          eq: (f2, v2) => ({
            select: async () => {
              if (mockDbError) throw mockDbError;
              const match = mockAnnouncements.find(a => a[f1] === v1 && a[f2] === v2);
              if (!match) return { data: [], error: null };
              Object.assign(match, updates);
              return { data: [match], error: null };
            }
          })
        })
      }),
      delete: () => ({
        eq: (f1, v1) => ({
          eq: (f2, v2) => ({
            select: async () => {
              if (mockDbError) throw mockDbError;
              const matchIndex = mockAnnouncements.findIndex(a => a[f1] === v1 && a[f2] === v2);
              if (matchIndex === -1) return { data: [], error: null };
              const deleted = mockAnnouncements.splice(matchIndex, 1);
              return { data: deleted, error: null };
            }
          })
        })
      }),
      then: (resolve, reject) => {
        if (mockDbError) return reject ? reject(mockDbError) : resolve({ data: null, error: mockDbError });
        let results = mockAnnouncements.filter(row => {
          for (const f of filters) {
            if (f.type === 'eq' && row[f.field] !== f.val) return false;
          }
          return true;
        });
        if (rangeLimits) {
          results = results.slice(rangeLimits.from, rangeLimits.to + 1);
        }
        resolve({ data: results, error: null });
      }
    };

    return builder;
  }
});

let announcementRoutes = [];
const mockRouter = Object.fromEntries(
  ['get', 'post', 'patch', 'delete'].map(method => [
    method,
    (path, ...handlers) => announcementRoutes.push({ method, path, handler: handlers.at(-1), middleware: handlers })
  ])
);

const prevLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'express') return { Router: () => mockRouter };
  if (name === '../services/supabase') return createMockSupabase();
  if (name === '../middleware/auth') {
    return {
      requireAuth: (req, res, next) => next(),
      requireRole: (role) => (req, res, next) => {
        if (req.user && req.user.role === role) return next();
        return res.status(403).json({ error: 'Forbidden - insufficient role' });
      }
    };
  }
  return prevLoad.call(this, name, ...args);
};

delete require.cache[require.resolve('../routes/announcements')];
try {
  require('../routes/announcements');
} finally {
  Module._load = prevLoad;
}

// ---------------------------------------------------------------------------
// 1. GET /announcements (Listing, Tenant Isolation, Pagination)
// ---------------------------------------------------------------------------
test('GET /announcements: Tenant Isolation, Formatting & Pagination', async (t) => {
  const route = announcementRoutes.find(r => r.method === 'get' && r.path === '/');
  assert.ok(route, 'GET /announcements route must be registered');

  await t.test('returns announcements for caller college with both body and content fields', async () => {
    mockDbError = null;
    mockAnnouncements = [
      { id: 'a1', college_id: 'col-1', title: 'College 1 Event', body: 'Please attend.', created_at: '2026-09-01T10:00:00Z' },
      { id: 'a2', college_id: 'col-2', title: 'College 2 Event', body: 'Secret event.', created_at: '2026-09-02T10:00:00Z' }
    ];

    const req = { user: { id: 'u1', collegeId: 'col-1', role: 'student' }, query: {} };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.announcements.length, 1);
    const ann = res.body.announcements[0];
    assert.equal(ann.id, 'a1');
    assert.equal(ann.title, 'College 1 Event');
    assert.equal(ann.body, 'Please attend.');
    assert.equal(ann.content, 'Please attend.', 'content alias must exist for Flutter model');
    assert.equal(ann.category, 'General', 'category must exist for Flutter model');
  });

  await t.test('returns empty array when college has no announcements', async () => {
    mockDbError = null;
    mockAnnouncements = [
      { id: 'a2', college_id: 'col-2', title: 'Other College', body: 'None.', created_at: '2026-09-02T10:00:00Z' }
    ];

    const req = { user: { id: 'u1', collegeId: 'col-1', role: 'student' }, query: {} };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.announcements, []);
  });

  await t.test('supports pagination with valid limit and page', async () => {
    mockDbError = null;
    mockAnnouncements = [
      { id: '1', college_id: 'col-1', title: 'A1', body: 'B1' },
      { id: '2', college_id: 'col-1', title: 'A2', body: 'B2' },
      { id: '3', college_id: 'col-1', title: 'A3', body: 'B3' }
    ];

    // Page 1, limit 2 -> items 1, 2
    const req1 = { user: { id: 'u1', collegeId: 'col-1', role: 'student' }, query: { limit: '2', page: '1' } };
    const res1 = createResponse();
    await route.handler(req1, res1);
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.body.announcements.length, 2);
    assert.equal(res1.body.announcements[0].id, '1');
    assert.equal(res1.body.announcements[1].id, '2');

    // Page 2, limit 2 -> item 3
    const req2 = { user: { id: 'u1', collegeId: 'col-1', role: 'student' }, query: { limit: '2', page: '2' } };
    const res2 = createResponse();
    await route.handler(req2, res2);
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.body.announcements.length, 1);
    assert.equal(res2.body.announcements[0].id, '3');
  });

  await t.test('rejects invalid pagination parameters with 400', async () => {
    const req1 = { user: { id: 'u1', collegeId: 'col-1', role: 'student' }, query: { limit: '-5' } };
    const res1 = createResponse();
    await route.handler(req1, res1);
    assert.equal(res1.statusCode, 400);

    const req2 = { user: { id: 'u1', collegeId: 'col-1', role: 'student' }, query: { limit: '10', page: '0' } };
    const res2 = createResponse();
    await route.handler(req2, res2);
    assert.equal(res2.statusCode, 400);
  });

  await t.test('handles database failure by returning 500 without leaking error details', async () => {
    mockDbError = new Error('Database connection terminated');
    const req = { user: { id: 'u1', collegeId: 'col-1', role: 'student' }, query: {} };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'Could not fetch announcements');
    mockDbError = null;
  });
});

// ---------------------------------------------------------------------------
// 2. POST /announcements (Admin Creation & Validation)
// ---------------------------------------------------------------------------
test('POST /announcements: Admin Creation & Validation', async (t) => {
  const route = announcementRoutes.find(r => r.method === 'post' && r.path === '/');
  assert.ok(route, 'POST /announcements route must be registered');

  await t.test('admin can create announcement with body', async () => {
    mockDbError = null;
    mockAnnouncements = [];

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      body: { title: 'Semester Exams Updated', body: 'Please check the portal.' }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 201);
    assert.ok(res.body.announcement);
    assert.equal(res.body.announcement.title, 'Semester Exams Updated');
    assert.equal(res.body.announcement.body, 'Please check the portal.');
    assert.equal(res.body.announcement.content, 'Please check the portal.');
    assert.equal(res.body.announcement.college_id, 'col-1');
  });

  await t.test('accepts "content" field alias for Flutter client compatibility', async () => {
    mockDbError = null;
    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      body: { title: 'Flutter Notice', content: 'Sent via content field' }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.announcement.body, 'Sent via content field');
  });

  await t.test('enforces college_id from authenticated token, ignoring body injection', async () => {
    mockDbError = null;
    const req = {
      user: { id: 'admin-1', collegeId: 'col-REAL', role: 'admin' },
      body: { title: 'Spoofed Announcement', body: 'Text', college_id: 'col-ATTACKER' }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.announcement.college_id, 'col-REAL', 'Must NEVER trust college_id from request body');
  });

  await t.test('rejects non-admin role via requireRole middleware with 403', () => {
    const requireRoleMw = route.middleware[1];
    assert.ok(requireRoleMw);

    const studentReq = { user: { id: 's1', role: 'student' } };
    const res1 = createResponse();
    let nextCalled1 = false;
    requireRoleMw(studentReq, res1, () => { nextCalled1 = true; });
    assert.equal(res1.statusCode, 403);
    assert.equal(nextCalled1, false);

    const clubHeadReq = { user: { id: 'ch1', role: 'club_head' } };
    const res2 = createResponse();
    let nextCalled2 = false;
    requireRoleMw(clubHeadReq, res2, () => { nextCalled2 = true; });
    assert.equal(res2.statusCode, 403);
    assert.equal(nextCalled2, false);
  });

  await t.test('rejects missing or whitespace-only title with 400', async () => {
    const req1 = { user: { id: 'a1', collegeId: 'col-1', role: 'admin' }, body: { body: 'Valid body' } };
    const res1 = createResponse();
    await route.handler(req1, res1);
    assert.equal(res1.statusCode, 400);

    const req2 = { user: { id: 'a1', collegeId: 'col-1', role: 'admin' }, body: { title: '   ', body: 'Valid body' } };
    const res2 = createResponse();
    await route.handler(req2, res2);
    assert.equal(res2.statusCode, 400);
  });

  await t.test('rejects missing or whitespace-only body with 400', async () => {
    const req1 = { user: { id: 'a1', collegeId: 'col-1', role: 'admin' }, body: { title: 'Valid Title' } };
    const res1 = createResponse();
    await route.handler(req1, res1);
    assert.equal(res1.statusCode, 400);

    const req2 = { user: { id: 'a1', collegeId: 'col-1', role: 'admin' }, body: { title: 'Valid Title', body: '   ' } };
    const res2 = createResponse();
    await route.handler(req2, res2);
    assert.equal(res2.statusCode, 400);
  });

  await t.test('rejects excessively long title (>200 chars) with 400', async () => {
    const longTitle = 'A'.repeat(201);
    const req = { user: { id: 'a1', collegeId: 'col-1', role: 'admin' }, body: { title: longTitle, body: 'Body' } };
    const res = createResponse();
    await route.handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('200 characters'));
  });

  await t.test('rejects excessively long body (>5000 chars) with 400', async () => {
    const longBody = 'B'.repeat(5001);
    const req = { user: { id: 'a1', collegeId: 'col-1', role: 'admin' }, body: { title: 'Title', body: longBody } };
    const res = createResponse();
    await route.handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('5000 characters'));
  });
});

// ---------------------------------------------------------------------------
// 3. PATCH /announcements/:id (Admin Updates & Tenant Scoping)
// ---------------------------------------------------------------------------
test('PATCH /announcements/:id: Update Validation & Tenant Scoping', async (t) => {
  const route = announcementRoutes.find(r => r.method === 'patch' && r.path === '/:id');
  assert.ok(route, 'PATCH /announcements/:id route must be registered');

  const VALID_UUID = '22222222-2222-4222-8222-222222222222';

  await t.test('admin can update title', async () => {
    mockDbError = null;
    mockAnnouncements = [
      { id: VALID_UUID, college_id: 'col-1', title: 'Old Title', body: 'Original Body' }
    ];

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: VALID_UUID },
      body: { title: 'New Updated Title' }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.announcement.title, 'New Updated Title');
    assert.equal(res.body.announcement.body, 'Original Body');
  });

  await t.test('rejects invalid UUID format with 400', async () => {
    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: 'not-a-uuid' },
      body: { title: 'Updated' }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('Invalid announcement ID format'));
  });

  await t.test('rejects empty update payload with 400', async () => {
    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: VALID_UUID },
      body: {}
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('No fields to update'));
  });

  await t.test('rejects whitespace-only title update with 400', async () => {
    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: VALID_UUID },
      body: { title: '   ' }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('title cannot be empty'));
  });

  await t.test('returns 404 when updating nonexistent announcement or another college record', async () => {
    mockAnnouncements = [
      { id: VALID_UUID, college_id: 'col-OTHER', title: 'Other College Announcement', body: 'Content' }
    ];

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: VALID_UUID },
      body: { title: 'Cross College Update' }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 404);
    assert.ok(res.body.error.includes('Announcement not found'));
  });
});

// ---------------------------------------------------------------------------
// 4. DELETE /announcements/:id (Admin Deletion & Tenant Scoping)
// ---------------------------------------------------------------------------
test('DELETE /announcements/:id: Deletion & Tenant Isolation', async (t) => {
  const route = announcementRoutes.find(r => r.method === 'delete' && r.path === '/:id');
  assert.ok(route, 'DELETE /announcements/:id route must be registered');

  const VALID_UUID = '33333333-3333-4333-8333-333333333333';

  await t.test('rejects invalid UUID format with 400', async () => {
    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: 'not-valid-id' }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 400);
  });

  await t.test('returns 404 when deleting cross-college announcement', async () => {
    mockAnnouncements = [
      { id: VALID_UUID, college_id: 'col-OTHER', title: 'Other College Notice' }
    ];

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: VALID_UUID }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(mockAnnouncements.length, 1, 'Cross-college item must NOT be deleted');
  });

  await t.test('admin successfully deletes announcement in their college', async () => {
    mockAnnouncements = [
      { id: VALID_UUID, college_id: 'col-1', title: 'Own Notice' }
    ];

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: VALID_UUID }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(mockAnnouncements.length, 0);
  });
});
