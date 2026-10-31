const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  generateDataset,
  calculatePercentage,
  BRANCH_CONFIG,
  YEAR_CONFIGS,
  DEFAULT_COLLEGE_ID,
  DEFAULT_EMAIL_DOMAIN
} = require('../scripts/generate_demo_data');

const dataDir = path.join(__dirname, '..', 'data');

test('Phase 1 & 2: Student Dataset & Profile Count Verification', async (t) => {
  const result = generateDataset();
  const students = result.students;

  await t.test('1. Exactly 3,200 total student profiles generated', () => {
    assert.equal(students.length, 3200, `Expected 3,200 students, got ${students.length}`);
  });

  await t.test('2. Exactly 800 students per academic year across all 4 years', () => {
    const yearCounts = {};
    for (const s of students) {
      yearCounts[s.year] = (yearCounts[s.year] || 0) + 1;
    }

    const expectedYears = ['First Year', 'Second Year', 'Third Year', 'Final Year'];
    for (const yr of expectedYears) {
      assert.equal(yearCounts[yr], 800, `Expected 800 students in ${yr}, got ${yearCounts[yr]}`);
    }
    assert.equal(Object.keys(yearCounts).length, 4, 'Should contain exactly 4 academic years');
  });

  await t.test('3. Branch and division breakdown strictly matches specifications', () => {
    // Computer: 3, IT: 3, EXTC: 2, ECS: 1, ARO: 1, AIDS: 2 = 12 divisions
    const expectedDivisionsPerBranch = {
      'Computer': 3,
      'IT': 3,
      'EXTC': 2,
      'ECS': 1,
      'ARO': 1,
      'AIDS': 2
    };

    const branchCounts = {};
    const divisionKeys = new Set();

    for (const s of students) {
      const divKey = `${s.year}-${s.branch}-${s.division}`;
      divisionKeys.add(divKey);
      const branchKey = `${s.year}-${s.branch}`;
      branchCounts[branchKey] = (branchCounts[branchKey] || new Set()).add(s.division);
    }

    // 12 divisions per year * 4 years = 48 divisions total
    assert.equal(divisionKeys.size, 48, `Expected 48 unique year-branch-division pairs, got ${divisionKeys.size}`);

    const years = ['First Year', 'Second Year', 'Third Year', 'Final Year'];
    for (const yr of years) {
      for (const [branch, expectedDivs] of Object.entries(expectedDivisionsPerBranch)) {
        const branchDivs = branchCounts[`${yr}-${branch}`];
        assert(branchDivs, `Branch ${branch} missing in year ${yr}`);
        assert.equal(branchDivs.size, expectedDivs, `Expected ${expectedDivs} divisions for ${branch} in ${yr}, got ${branchDivs.size}`);
      }
    }
  });

  await t.test('4. Division sizes: all divisions have 60 to 70 students', () => {
    const divisionCounts = {};
    for (const s of students) {
      const divKey = `${s.year_code}-${s.division}`;
      divisionCounts[divKey] = (divisionCounts[divKey] || 0) + 1;
    }

    for (const [div, count] of Object.entries(divisionCounts)) {
      assert(
        count >= 60 && count <= 70,
        `Division ${div} has ${count} students; must be between 60 and 70 inclusive`
      );
    }
  });

  await t.test('5. First-year divisions generally smaller, second-year divisions generally larger', () => {
    const feSizes = [];
    const seSizes = [];

    for (const s of students) {
      const divKey = `${s.year_code}-${s.division}`;
      if (s.year_code === 'FE' && !feSizes.includes(divKey)) feSizes.push(divKey);
      if (s.year_code === 'SE' && !seSizes.includes(divKey)) seSizes.push(divKey);
    }

    const feCounts = Object.entries(result.divisionStats)
      .filter(([k]) => k.startsWith('FE-'))
      .map(([, v]) => v.count);

    const seCounts = Object.entries(result.divisionStats)
      .filter(([k]) => k.startsWith('SE-'))
      .map(([, v]) => v.count);

    const minFE = Math.min(...feCounts);
    const minSE = Math.min(...seCounts);

    // FE divisions start smaller (down to 61)
    assert(minFE <= 62, `FE minimum division size should be <= 62, got ${minFE}`);
    assert(minSE >= 64, `SE minimum division size should be >= 64, got ${minSE}`);

    const feSmallerDivs = feCounts.filter(c => c <= 65).length;
    const seSmallerDivs = seCounts.filter(c => c <= 65).length;
    assert(feSmallerDivs >= 5, `FE should have prominent smaller divisions (<=65), got ${feSmallerDivs}`);
    assert(seSmallerDivs <= 4, `SE should have fewer smaller divisions, got ${seSmallerDivs}`);
  });

  await t.test('6. Uniqueness of student ID, email, and roll number', () => {
    const ids = new Set();
    const emails = new Set();
    const rollNumbers = new Set();

    for (const s of students) {
      assert(!ids.has(s.id), `Duplicate student ID found: ${s.id}`);
      assert(!emails.has(s.email), `Duplicate student email found: ${s.email}`);
      assert(!rollNumbers.has(s.roll_number), `Duplicate roll number found: ${s.roll_number}`);

      ids.add(s.id);
      emails.add(s.email);
      rollNumbers.add(s.roll_number);

      // Verify email domain matches college domain
      assert(s.email.endsWith(`@${DEFAULT_EMAIL_DOMAIN}`), `Email domain mismatch: ${s.email}`);
      assert.equal(s.college_id, DEFAULT_COLLEGE_ID, `College ID mismatch: ${s.college_id}`);
    }

    assert.equal(ids.size, 3200, '3,200 unique student IDs');
    assert.equal(emails.size, 3200, '3,200 unique emails');
    assert.equal(rollNumbers.size, 3200, '3,200 unique roll numbers');
  });
});

test('Phase 1 & 2: Attendance Records Integrity Verification', async (t) => {
  const result = generateDataset();
  const attendance = result.attendance;
  const students = result.students;
  const studentMap = new Map(students.map(s => [s.id, s]));

  await t.test('1. Exactly 16,000 attendance records generated (5 subjects per student)', () => {
    assert.equal(attendance.length, 16000, `Expected 16,000 attendance records, got ${attendance.length}`);
  });

  await t.test('2. Attended classes never exceed total conducted classes', () => {
    for (const a of attendance) {
      assert(
        a.attended_classes <= a.total_classes,
        `Integrity violation: attended (${a.attended_classes}) > total (${a.total_classes}) for student ${a.student_id}`
      );
      assert(a.attended_classes >= 0, `Attended classes cannot be negative: ${a.attended_classes}`);
      assert(a.total_classes > 0, `Total classes must be positive: ${a.total_classes}`);
    }
  });

  await t.test('3. Attendance percentage calculated correctly with 2 decimal precision', () => {
    for (const a of attendance) {
      const expected = calculatePercentage(a.attended_classes, a.total_classes);
      assert.equal(
        a.percentage,
        expected,
        `Percentage mismatch: got ${a.percentage}, expected ${expected} for ${a.attended_classes}/${a.total_classes}`
      );
      assert(a.percentage >= 0.0 && a.percentage <= 100.0, `Percentage out of bounds: ${a.percentage}`);
    }
  });

  await t.test('4. No duplicate attendance records per (college_id, student_id, subject, semester)', () => {
    const compositeKeys = new Set();
    for (const a of attendance) {
      const key = `${a.college_id}:${a.student_id}:${a.subject}:${a.semester}`;
      assert(!compositeKeys.has(key), `Duplicate attendance key: ${key}`);
      compositeKeys.add(key);

      // Verify foreign key integrity to student dataset
      assert(studentMap.has(a.student_id), `Attendance student_id ${a.student_id} not found in students dataset`);
    }
    assert.equal(compositeKeys.size, 16000, 'All 16,000 attendance entries have unique composite keys');
  });
});

test('Phase 1 & 2: Seed Repeatability & Artifacts Verification', async (t) => {
  await t.test('1. Generator is 100% deterministic and repeatable', () => {
    const run1 = generateDataset({ seed: 424242 });
    const run2 = generateDataset({ seed: 424242 });

    assert.equal(run1.students.length, run2.students.length);
    assert.equal(run1.attendance.length, run2.attendance.length);

    // Deep compare first, middle, and last records
    for (const idx of [0, 500, 1500, 3199]) {
      assert.deepEqual(run1.students[idx], run2.students[idx], `Student at index ${idx} mismatch across runs`);
    }

    for (const idx of [0, 2000, 8000, 15999]) {
      assert.deepEqual(run1.attendance[idx], run2.attendance[idx], `Attendance at index ${idx} mismatch across runs`);
    }
  });

  await t.test('2. Output seed artifacts exist on disk and are valid', () => {
    const requiredFiles = [
      'students_seed.json',
      'attendance_seed.json',
      'students_summary.json',
      'students_seed.csv',
      'attendance_seed.csv',
      'seed_students_and_attendance.sql'
    ];

    for (const f of requiredFiles) {
      const p = path.join(dataDir, f);
      assert(fs.existsSync(p), `Missing required seed file: ${f}`);
      const stats = fs.statSync(p);
      assert(stats.size > 0, `File ${f} is empty`);
    }

    // Verify SQL script contains idempotency guards (ON CONFLICT)
    const sqlContent = fs.readFileSync(path.join(dataDir, 'seed_students_and_attendance.sql'), 'utf8');
    assert(sqlContent.includes('ON CONFLICT (email) DO UPDATE'), 'SQL must contain idempotent user conflict handling');
    assert(sqlContent.includes('ON CONFLICT (college_id, student_id, subject, semester) DO UPDATE'), 'SQL must contain idempotent attendance conflict handling');
  });
});
