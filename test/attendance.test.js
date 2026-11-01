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
// Mock Supabase Setup for Attendance API Unit Testing
// ---------------------------------------------------------------------------
let mockAttendanceData = [];
let mockUsersData = [];
let mockDbError = null;

const createMockSupabase = () => ({
  from: (table) => {
    let selectedColumns = '*';
    let filters = [];
    let orderClause = null;

    const builder = {
      select: (cols) => {
        selectedColumns = cols;
        return builder;
      },
      eq: (field, val) => {
        filters.push({ type: 'eq', field, val });
        return builder;
      },
      ilike: (field, pattern) => {
        filters.push({ type: 'ilike', field, pattern });
        return builder;
      },
      order: (field, opts) => {
        orderClause = { field, opts };
        return builder;
      },
      single: async () => {
        if (mockDbError) throw mockDbError;
        const results = executeFilter();
        if (results.length === 0) {
          return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
        }
        return { data: results[0], error: null };
      },
      maybeSingle: async () => {
        if (mockDbError) throw mockDbError;
        const results = executeFilter();
        if (results.length === 0) return { data: null, error: null };
        if (results.length > 1) {
          return { data: null, error: { message: 'Multiple rows returned', code: 'PGRST116' } };
        }
        return { data: results[0], error: null };
      },
      insert: (recordOrRecords) => {
        const records = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
        const inserted = records.map((r, i) => ({ id: `att-new-${Date.now()}-${i}`, ...r }));
        mockAttendanceData.push(...inserted);

        return {
          select: () => ({
            single: async () => {
              if (mockDbError) throw mockDbError;
              return { data: inserted[0], error: null };
            }
          }),
          then: (resolve) => {
            if (mockDbError) return resolve({ data: null, error: mockDbError });
            resolve({ data: inserted, error: null });
          }
        };
      },
      upsert: (records, opts) => ({
        select: async () => {
          if (mockDbError) return { data: null, error: mockDbError };
          return { data: records, error: null };
        }
      }),
      update: (updates) => ({
        eq: (f1, v1) => ({
          eq: (f2, v2) => ({
            select: () => ({
              single: async () => {
                if (mockDbError) throw mockDbError;
                const match = mockAttendanceData.find(a => a[f1] === v1 && a[f2] === v2);
                if (!match) return { data: null, error: { message: 'Not found' } };
                Object.assign(match, updates);
                return { data: match, error: null };
              }
            })
          })
        })
      }),
      delete: () => ({
        eq: (f1, v1) => ({
          eq: async (f2, v2) => {
            if (mockDbError) throw mockDbError;
            mockAttendanceData = mockAttendanceData.filter(a => !(a[f1] === v1 && a[f2] === v2));
            return { error: null };
          }
        })
      }),
      then: (resolve, reject) => {
        if (mockDbError) return reject ? reject(mockDbError) : resolve({ data: null, error: mockDbError });
        const results = executeFilter();
        resolve({ data: results, error: null });
      }
    };

    function executeFilter() {
      const source = table === 'attendance' ? mockAttendanceData : mockUsersData;
      return source.filter(row => {
        for (const f of filters) {
          if (f.type === 'eq' && row[f.field] !== f.val) return false;
          if (f.type === 'ilike') {
            const rowVal = String(row[f.field] || '').toLowerCase();
            const pat = String(f.pattern || '').toLowerCase().replace(/%/g, '');
            if (!rowVal.includes(pat)) return false;
          }
        }
        return true;
      });
    }

    return builder;
  }
});

// Setup mocked environment and load attendance routes
let attendanceRoutes = [];
const mockRouter = Object.fromEntries(
  ['get', 'post', 'patch', 'delete'].map(method => [
    method,
    (path, ...handlers) => attendanceRoutes.push({ method, path, handler: handlers.at(-1), middleware: handlers })
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
        return res.status(403).json({ error: 'Forbidden' });
      }
    };
  }
  return prevLoad.call(this, name, ...args);
};

delete require.cache[require.resolve('../routes/attendance')];
try {
  require('../routes/attendance');
} finally {
  Module._load = prevLoad;
}

// ---------------------------------------------------------------------------
// 1. GET /attendance/me (Student Attendance & Metrics)
// ---------------------------------------------------------------------------
test('GET /attendance/me: Student Attendance & Metrics Calculation', async (t) => {
  const route = attendanceRoutes.find(r => r.method === 'get' && r.path === '/me');
  assert.ok(route, 'GET /attendance/me must be registered');

  await t.test('calculates correct summary metrics for populated attendance', async () => {
    mockDbError = null;
    mockAttendanceData = [
      { id: '1', college_id: 'col-1', student_id: 'stud-1', subject: 'Math', attended_classes: 24, total_classes: 30, percentage: 80.0, semester: 'SEM 3' },
      { id: '2', college_id: 'col-1', student_id: 'stud-1', subject: 'Physics', attended_classes: 21, total_classes: 30, percentage: 70.0, semester: 'SEM 3' }
    ];

    const req = { user: { id: 'stud-1', collegeId: 'col-1', role: 'student' }, query: {} };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.attendance.length, 2);
    assert.equal(res.body.summary.total_subjects, 2);
    assert.equal(res.body.summary.total_attended_classes, 45);
    assert.equal(res.body.summary.total_conducted_classes, 60);
    assert.equal(res.body.summary.overall_percentage, 75.0);
    assert.equal(res.body.summary.low_attendance_subjects_count, 1);
    assert.equal(res.body.summary.is_defaulter, false); // 75% is threshold, not < 75%
  });

  await t.test('flags student as defaulter when overall percentage < 75%', async () => {
    mockDbError = null;
    mockAttendanceData = [
      { id: '1', college_id: 'col-1', student_id: 'stud-1', subject: 'Math', attended_classes: 15, total_classes: 30, percentage: 50.0 }
    ];

    const req = { user: { id: 'stud-1', collegeId: 'col-1', role: 'student' }, query: {} };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.summary.is_defaulter, true);
    assert.equal(res.body.summary.low_attendance_subjects_count, 1);
  });

  await t.test('handles student with zero attendance records without division by zero', async () => {
    mockDbError = null;
    mockAttendanceData = [];

    const req = { user: { id: 'stud-empty', collegeId: 'col-1', role: 'student' }, query: {} };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.attendance, []);
    assert.equal(res.body.summary.total_subjects, 0);
    assert.equal(res.body.summary.total_attended_classes, 0);
    assert.equal(res.body.summary.total_conducted_classes, 0);
    assert.equal(res.body.summary.overall_percentage, 0);
    assert.equal(res.body.summary.is_defaulter, false);
  });

  await t.test('filters records by semester and academic_year when provided', async () => {
    mockDbError = null;
    mockAttendanceData = [
      { id: '1', college_id: 'col-1', student_id: 'stud-1', subject: 'Math', attended_classes: 25, total_classes: 30, percentage: 83.33, semester: 'SEM 3', academic_year: '2026-2027' },
      { id: '2', college_id: 'col-1', student_id: 'stud-1', subject: 'Chemistry', attended_classes: 28, total_classes: 30, percentage: 93.33, semester: 'SEM 1', academic_year: '2025-2026' }
    ];

    const req = { user: { id: 'stud-1', collegeId: 'col-1', role: 'student' }, query: { semester: 'SEM 3', academic_year: '2026-2027' } };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.attendance.length, 1);
    assert.equal(res.body.attendance[0].subject, 'Math');
  });

  await t.test('handles database failure by returning 500', async () => {
    mockDbError = new Error('Database query failure');
    const req = { user: { id: 'stud-1', collegeId: 'col-1', role: 'student' }, query: {} };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'Could not fetch attendance records');
    mockDbError = null;
  });
});

// ---------------------------------------------------------------------------
// 2. GET /attendance/me/:subject (Single Subject & Disambiguation)
// ---------------------------------------------------------------------------
test('GET /attendance/me/:subject: Single Subject and Multiple Semester Disambiguation', async (t) => {
  const route = attendanceRoutes.find(r => r.method === 'get' && r.path === '/me/:subject');
  assert.ok(route, 'GET /attendance/me/:subject must be registered');

  await t.test('returns single subject record when exactly 1 record matches', async () => {
    mockDbError = null;
    mockAttendanceData = [
      { id: 'att-1', college_id: 'col-1', student_id: 'stud-1', subject: 'Operating Systems', attended_classes: 28, total_classes: 32, percentage: 87.5, semester: 'SEM 5' }
    ];

    const req = { user: { id: 'stud-1', collegeId: 'col-1', role: 'student' }, params: { subject: 'Operating Systems' }, query: {} };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.attendance.subject, 'Operating Systems');
    assert.equal(res.body.attendance.percentage, 87.5);
  });

  await t.test('returns 404 when subject does not exist for the student', async () => {
    mockDbError = null;
    mockAttendanceData = [];

    const req = { user: { id: 'stud-1', collegeId: 'col-1', role: 'student' }, params: { subject: 'Nonexistent Subject' }, query: {} };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 404);
    assert.ok(res.body.error.includes('No attendance record found'));
  });

  await t.test('returns 400 Bad Request when multiple semester records match without semester param', async () => {
    mockDbError = null;
    // Same student has a subject with matching name across two different semesters
    mockAttendanceData = [
      { id: 'att-1', college_id: 'col-1', student_id: 'stud-1', subject: 'Mini Project', attended_classes: 15, total_classes: 15, percentage: 100.0, semester: 'SEM 3' },
      { id: 'att-2', college_id: 'col-1', student_id: 'stud-1', subject: 'Mini Project', attended_classes: 12, total_classes: 15, percentage: 80.0, semester: 'SEM 4' }
    ];

    const req = { user: { id: 'stud-1', collegeId: 'col-1', role: 'student' }, params: { subject: 'Mini Project' }, query: {} };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('Multiple attendance records found'), 'Must not arbitrarily pick first record');
    assert.ok(res.body.error.includes('semester'), 'Must advise client to specify semester parameter');
  });

  await t.test('returns matching record when semester param disambiguates multiple records', async () => {
    mockDbError = null;
    mockAttendanceData = [
      { id: 'att-1', college_id: 'col-1', student_id: 'stud-1', subject: 'Mini Project', attended_classes: 15, total_classes: 15, percentage: 100.0, semester: 'SEM 3' },
      { id: 'att-2', college_id: 'col-1', student_id: 'stud-1', subject: 'Mini Project', attended_classes: 12, total_classes: 15, percentage: 80.0, semester: 'SEM 4' }
    ];

    const req = { user: { id: 'stud-1', collegeId: 'col-1', role: 'student' }, params: { subject: 'Mini Project' }, query: { semester: 'SEM 4' } };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.attendance.id, 'att-2');
    assert.equal(res.body.attendance.semester, 'SEM 4');
    assert.equal(res.body.attendance.percentage, 80.0);
  });

  await t.test('handles empty or whitespace semester parameter as omitted filter', async () => {
    mockDbError = null;
    mockAttendanceData = [
      { id: 'att-1', college_id: 'col-1', student_id: 'stud-1', subject: 'Mini Project', attended_classes: 15, total_classes: 15, percentage: 100.0, semester: 'SEM 3' },
      { id: 'att-2', college_id: 'col-1', student_id: 'stud-1', subject: 'Mini Project', attended_classes: 12, total_classes: 15, percentage: 80.0, semester: 'SEM 4' }
    ];

    const req = { user: { id: 'stud-1', collegeId: 'col-1', role: 'student' }, params: { subject: 'Mini Project' }, query: { semester: '   ' } };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('Multiple attendance records found'));
  });

  await t.test('returns 404 when semester is specified but has no matching record', async () => {
    mockDbError = null;
    mockAttendanceData = [
      { id: 'att-1', college_id: 'col-1', student_id: 'stud-1', subject: 'Operating Systems', attended_classes: 28, total_classes: 32, percentage: 87.5, semester: 'SEM 5' }
    ];

    const req = { user: { id: 'stud-1', collegeId: 'col-1', role: 'student' }, params: { subject: 'Operating Systems' }, query: { semester: 'SEM 8' } };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 404);
    assert.ok(res.body.error.includes('No attendance record found'));
  });
});

// ---------------------------------------------------------------------------
// 3. GET /attendance/student/:student_id (Student Isolation & Role Authorization)
// ---------------------------------------------------------------------------
test('GET /attendance/student/:student_id: Role Authorization & Tenant Scoping', async (t) => {
  const route = attendanceRoutes.find(r => r.method === 'get' && r.path === '/student/:student_id');
  assert.ok(route, 'GET /attendance/student/:student_id must be registered');

  await t.test('rejects student attempting to access another student attendance with 403', async () => {
    const req = {
      user: { id: 'student-A', collegeId: 'col-1', role: 'student' },
      params: { student_id: 'student-B' },
      query: {}
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 403);
    assert.ok(res.body.error.includes('Forbidden'));
  });

  await t.test('permits student accessing their own attendance via this endpoint', async () => {
    mockDbError = null;
    mockUsersData = [{ id: 'student-A', college_id: 'col-1', name: 'Student A', email: 'a@vesit.ac.in' }];
    mockAttendanceData = [
      { id: 'att-1', college_id: 'col-1', student_id: 'student-A', subject: 'Math', attended_classes: 10, total_classes: 10, percentage: 100 }
    ];

    const req = {
      user: { id: 'student-A', collegeId: 'col-1', role: 'student' },
      params: { student_id: 'student-A' },
      query: {}
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.student.id, 'student-A');
    assert.equal(res.body.attendance.length, 1);
  });

  await t.test('permits admin accessing attendance for any student in their college', async () => {
    mockDbError = null;
    mockUsersData = [{ id: 'student-X', college_id: 'col-1', name: 'Student X', email: 'x@vesit.ac.in' }];
    mockAttendanceData = [
      { id: 'att-10', college_id: 'col-1', student_id: 'student-X', subject: 'Robotics', attended_classes: 18, total_classes: 20, percentage: 90 }
    ];

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { student_id: 'student-X' },
      query: {}
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.student.id, 'student-X');
    assert.equal(res.body.attendance.length, 1);
  });

  await t.test('returns 404 if student does not exist or belongs to another college', async () => {
    mockDbError = null;
    mockUsersData = []; // No student in col-1

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { student_id: 'student-cross-college' },
      query: {}
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 404);
    assert.ok(res.body.error.includes('Student not found in your college'));
  });
});

// ---------------------------------------------------------------------------
// 4. POST /attendance (Admin Creation & Strict Number Validation)
// ---------------------------------------------------------------------------
test('POST /attendance: Validation & Business Rules Enforcement', async (t) => {
  const route = attendanceRoutes.find(r => r.method === 'post' && r.path === '/');
  assert.ok(route, 'POST /attendance must be registered');

  await t.test('rejects missing required fields with 400', async () => {
    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      body: { student_id: 's-1' } // missing subject, attended, total
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('required'));
  });

  await t.test('rejects negative numbers or NaN with 400', async () => {
    const req1 = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      body: { student_id: 's-1', subject: 'Math', attended_classes: -5, total_classes: 20 }
    };
    const res1 = createResponse();
    await route.handler(req1, res1);
    assert.equal(res1.statusCode, 400);

    const req2 = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      body: { student_id: 's-1', subject: 'Math', attended_classes: 'invalid', total_classes: 20 }
    };
    const res2 = createResponse();
    await route.handler(req2, res2);
    assert.equal(res2.statusCode, 400);
  });

  await t.test('rejects attended_classes exceeding total_classes with 400', async () => {
    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      body: { student_id: 's-1', subject: 'Math', attended_classes: 35, total_classes: 30 }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('cannot exceed'));
  });

  await t.test('returns 404 when student does not belong to the admin college', async () => {
    mockUsersData = []; // No student in col-1
    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      body: { student_id: 's-other', subject: 'Math', attended_classes: 20, total_classes: 25 }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 404);
    assert.ok(res.body.error.includes('does not exist or does not belong'));
  });

  await t.test('creates attendance record and calculates accurate 2-decimal percentage', async () => {
    mockUsersData = [{ id: 's-1', college_id: 'col-1' }];
    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      body: {
        student_id: 's-1',
        subject: 'Algorithms',
        attended_classes: 22,
        total_classes: 27,
        semester: 'SEM 3',
        division: 'CMPN-A',
        academic_year: '2026-2027'
      }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 201);
    assert.ok(res.body.attendance);
    assert.equal(res.body.attendance.subject, 'Algorithms');
    assert.equal(res.body.attendance.percentage, 81.48); // 22/27 * 100 = 81.48148...
  });
});

// ---------------------------------------------------------------------------
// 5. PATCH /attendance/:id (Admin Updates & Percentage Recalculation)
// ---------------------------------------------------------------------------
test('PATCH /attendance/:id: Update and Integrity Validation', async (t) => {
  const route = attendanceRoutes.find(r => r.method === 'patch' && r.path === '/:id');
  assert.ok(route, 'PATCH /attendance/:id must be registered');

  await t.test('returns 404 when record does not exist or belongs to another college', async () => {
    mockAttendanceData = [];
    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: 'att-nonexistent' },
      body: { attended_classes: 20 }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 404);
    assert.ok(res.body.error.includes('not found in your college'));
  });

  await t.test('rejects update where attended_classes exceeds total_classes with 400', async () => {
    mockAttendanceData = [
      { id: 'att-exist-1', college_id: 'col-1', student_id: 's-1', subject: 'Math', attended_classes: 15, total_classes: 20, percentage: 75.0 }
    ];

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: 'att-exist-1' },
      body: { attended_classes: 25 } // 25 > 20
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('cannot exceed'));
  });

  await t.test('successfully updates numbers and recalculates percentage', async () => {
    mockAttendanceData = [
      { id: 'att-exist-2', college_id: 'col-1', student_id: 's-1', subject: 'Math', attended_classes: 15, total_classes: 20, percentage: 75.0 }
    ];

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: 'att-exist-2' },
      body: { attended_classes: 18 } // 18 / 20 = 90%
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.attendance.attended_classes, 18);
    assert.equal(res.body.attendance.percentage, 90.0);
  });
});

// ---------------------------------------------------------------------------
// 6. POST /attendance/bulk (Bulk Import & Validation)
// ---------------------------------------------------------------------------
test('POST /attendance/bulk: Batch Import and Integrity Checking', async (t) => {
  const route = attendanceRoutes.find(r => r.method === 'post' && r.path === '/bulk');
  assert.ok(route, 'POST /attendance/bulk must be registered');

  await t.test('rejects empty or non-array records payload with 400', async () => {
    const req1 = { user: { id: 'a1', collegeId: 'c1', role: 'admin' }, body: [] };
    const res1 = createResponse();
    await route.handler(req1, res1);
    assert.equal(res1.statusCode, 400);

    const req2 = { user: { id: 'a1', collegeId: 'c1', role: 'admin' }, body: { records: [] } };
    const res2 = createResponse();
    await route.handler(req2, res2);
    assert.equal(res2.statusCode, 400);
  });

  await t.test('identifies record with attended > total and rejects entire batch with index', async () => {
    const req = {
      user: { id: 'a1', collegeId: 'c1', role: 'admin' },
      body: [
        { student_id: 's1', subject: 'Math', attended_classes: 10, total_classes: 12 },
        { student_id: 's2', subject: 'Math', attended_classes: 15, total_classes: 10 } // index 1 invalid
      ]
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('Record at index 1'));
    assert.ok(res.body.error.includes('cannot exceed'));
  });

  await t.test('imports valid batch and computes percentages', async () => {
    const req = {
      user: { id: 'a1', collegeId: 'c1', role: 'admin' },
      body: [
        { student_id: 's1', subject: 'Math', attended_classes: 10, total_classes: 10 },
        { student_id: 's2', subject: 'Math', attended_classes: 8, total_classes: 10 }
      ]
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.count, 2);
  });
});

// ---------------------------------------------------------------------------
// 7. DELETE /attendance/:id (Admin Deletion & College Isolation)
// ---------------------------------------------------------------------------
test('DELETE /attendance/:id: College-Scoped Deletion', async (t) => {
  const route = attendanceRoutes.find(r => r.method === 'delete' && r.path === '/:id');
  assert.ok(route, 'DELETE /attendance/:id must be registered');

  await t.test('returns 404 when deleting nonexistent or cross-college record', async () => {
    mockAttendanceData = [
      { id: 'att-other-college', college_id: 'col-OTHER' }
    ];

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: 'att-other-college' }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 404);
  });

  await t.test('successfully deletes record belonging to admin college', async () => {
    mockAttendanceData = [
      { id: 'att-del-1', college_id: 'col-1' }
    ];

    const req = {
      user: { id: 'admin-1', collegeId: 'col-1', role: 'admin' },
      params: { id: 'att-del-1' }
    };
    const res = createResponse();
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(mockAttendanceData.length, 0);
  });
});
