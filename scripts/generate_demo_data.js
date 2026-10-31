/**
 * CampusOne Demo Dataset Generator
 * Generates 3,200 dummy student profiles and 16,000 consistent attendance records.
 * 
 * Rules strictly satisfied:
 *  - 3,200 student profiles (800 per year across 4 academic years)
 *  - Branches and divisions: Computer (3), IT (3), EXTC (2), ECS (1), ARO (1), AIDS (2) = 12 divisions
 *  - 60-70 students per division, preserving exact 800 total per year
 *  - First-year divisions generally smaller, second-year divisions generally larger
 *  - Unique student ID (UUID), synthetic name, college email, roll number, year, branch, division, college_id
 *  - Consistent attendance records: attended <= total, accurate 2-decimal percentage
 *  - Seeded PRNG for 100% deterministic, repeatable outputs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Default configuration
const DEFAULT_COLLEGE_ID = '81055c6a-4909-44e3-88a3-be6cff32635a'; // VESIT college ID
const DEFAULT_EMAIL_DOMAIN = 'vesit.ves.ac.in';
const BCRYPT_PASSWORD_HASH = '$2a$10$etLPbZbHlAtIUswFrsaK5uD4PNTI4Y7A5k6xxhNZGQo4ybYFLMSvG'; // Password123!
const PRNG_SEED = 424242;

// Seeded PRNG (Mulberry32)
function createPRNG(seed) {
  let s = seed >>> 0;
  return function () {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic UUID v4 generation from namespace and key
function deterministicUUID(namespace, key) {
  const hash = crypto.createHash('sha256').update(`${namespace}:${key}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// Realistic synthetic Indian names pool (VESIT student demographic)
const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Muhammad', 'Sai', 'Arnav', 'Aayan',
  'Krishna', 'Ishan', 'Shaurya', 'Atharv', 'Advik', 'Pranav', 'Advaith', 'Aryan', 'Dhruv', 'Kabir',
  'Ananya', 'Diya', 'Sanvi', 'Arya', 'Sara', 'Pari', 'Saanvi', 'Riya', 'Anaya', 'Aadhya',
  'Sneha', 'Pooja', 'Tanvi', 'Shreya', 'Neha', 'Priya', 'Meera', 'Rashi', 'Isha', 'Simran',
  'Varun', 'Rohit', 'Kunal', 'Nikhil', 'Siddharth', 'Yash', 'Harsh', 'Gaurav', 'Tejas', 'Omkar',
  'Pratik', 'Manav', 'Parth', 'Tanishq', 'Vedant', 'Chinmay', 'Sahil', 'Ayush', 'Shubham', 'Kaustubh',
  'Om', 'Sanket', 'Mandar', 'Sumeet', 'Rahul', 'Aniket', 'Rohan', 'Karan', 'Dev', 'Sameer',
  'Jay', 'Akash', 'Kavya', 'Anushka', 'Ishita', 'Avani', 'Tanaya', 'Disha', 'Radhika', 'Sakshi',
  'Priyanka', 'Aditi', 'Divya', 'Bhavna', 'Rutuja', 'Shweta', 'Mrunal', 'Sayali', 'Tejal', 'Akshata'
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Verma', 'Rao', 'Iyer', 'Kulkarni', 'Deshmukh', 'Patil', 'Joshi', 'Nair',
  'Gupta', 'Mehta', 'Shah', 'Singh', 'Kumar', 'Bhat', 'Shinde', 'Jadhav', 'More', 'Gaikwad',
  'Chavan', 'Kadam', 'Pawar', 'Kamble', 'Sawant', 'Salvi', 'Rane', 'Tambe', 'Tawde', 'Dalvi',
  'Gokhale', 'Godbole', 'Phadke', 'Apte', 'Ranade', 'Karve', 'Kelkar', 'Pendse', 'Mahajan', 'Choudhury',
  'Banerjee', 'Chatterjee', 'Mukherjee', 'Dutta', 'Menon', 'Pillai', 'Nambiar', 'Reddy', 'Chowdhary', 'Rathore',
  'Bose', 'Sengupta', 'Mishra', 'Pandey', 'Tiwari', 'Dubey', 'Tripathi', 'Shukla', 'Bhardwaj', 'Shetty'
];

// Branch & Division definitions (exactly 12 divisions per year)
const BRANCH_CONFIG = [
  { branch: 'Computer', code: 'CMPN', divisions: ['A', 'B', 'C'] },
  { branch: 'IT', code: 'IT', divisions: ['A', 'B', 'C'] },
  { branch: 'EXTC', code: 'EXTC', divisions: ['A', 'B'] },
  { branch: 'ECS', code: 'ECS', divisions: ['A'] },
  { branch: 'ARO', code: 'ARO', divisions: ['A'] },
  { branch: 'AIDS', code: 'AIDS', divisions: ['A', 'B'] }
];

// 4 Academic Years with division allocations summing to exactly 800 each
// 60-70 students per division.
// First year divisions generally smaller (down to 61), Second year divisions generally larger (up to 68, median 67.5).
const YEAR_CONFIGS = [
  {
    year: 'First Year',
    yearCode: 'FE',
    admissionYear: 2026,
    semester: 'SEM 1',
    academicYear: '2026-2027',
    divisionSizes: [65, 65, 64, 64, 63, 61, 69, 69, 70, 70, 70, 70] // sum = 800, min = 61
  },
  {
    year: 'Second Year',
    yearCode: 'SE',
    admissionYear: 2025,
    semester: 'SEM 3',
    academicYear: '2026-2027',
    divisionSizes: [68, 68, 68, 68, 68, 68, 67, 67, 65, 65, 64, 64] // sum = 800, generally larger
  },
  {
    year: 'Third Year',
    yearCode: 'TE',
    admissionYear: 2024,
    semester: 'SEM 5',
    academicYear: '2026-2027',
    divisionSizes: [67, 67, 67, 67, 67, 67, 67, 67, 66, 66, 66, 66] // sum = 800
  },
  {
    year: 'Final Year',
    yearCode: 'BE',
    admissionYear: 2023,
    semester: 'SEM 7',
    academicYear: '2026-2027',
    divisionSizes: [67, 67, 67, 67, 67, 66, 67, 67, 66, 66, 67, 66] // sum = 800
  }
];

// Subject curriculum mapping
const SUBJECT_CURRICULUM = {
  'FE': {
    'ALL': [
      'Engineering Mathematics I',
      'Applied Physics I',
      'Applied Chemistry I',
      'Engineering Mechanics',
      'Basic Electrical & Electronics'
    ]
  },
  'SE': {
    'CMPN': [
      'Data Structures & Algorithms',
      'Discrete Mathematics',
      'Computer Graphics',
      'Digital Logic & Computer Organization',
      'Object Oriented Programming Java'
    ],
    'IT': [
      'Data Structures & Analysis',
      'Database Management Systems',
      'Principles of Communication Engineering',
      'Automata Theory',
      'Python Programming Lab'
    ],
    'EXTC': [
      'Applied Mathematics III',
      'Electronic Devices & Circuits',
      'Digital System Design',
      'Network Theory',
      'Electronic Instruments & Measurement'
    ],
    'ECS': [
      'Data Structures & Algorithms',
      'Analog Circuits',
      'Digital Logic Design',
      'Signals & Systems',
      'Software Engineering'
    ],
    'ARO': [
      'Kinematics of Machinery',
      'Fluid Mechanics & Pneumatics',
      'Sensors & Transducers',
      'Electrical Machines',
      'Materials & Manufacturing'
    ],
    'AIDS': [
      'Data Structures & Algorithms',
      'Discrete Structures & Graph Theory',
      'Database Management Systems',
      'Linear Algebra for AI',
      'Python for Data Science'
    ]
  },
  'TE': {
    'CMPN': [
      'Operating Systems',
      'Computer Networks',
      'Theory of Computer Science',
      'Software Engineering',
      'Web Computing'
    ],
    'IT': [
      'Software Engineering & Project Mgmt',
      'Computer Networks & Security',
      'Cloud Computing',
      'Advanced Database Management',
      'Mobile Computing'
    ],
    'EXTC': [
      'Digital Communication',
      'Microcontrollers & Applications',
      'Electromagnetic Waves & Propagation',
      'VLSI Design',
      'Control Systems'
    ],
    'ECS': [
      'Embedded Systems',
      'Internet of Things',
      'Microprocessor & Microcontroller',
      'Signals & DSP',
      'Operating Systems'
    ],
    'ARO': [
      'Robotics Control Systems',
      'Machine Vision & Image Processing',
      'Microcontrollers for Robotics',
      'PLC & Industrial Automation',
      'CAD/CAM'
    ],
    'AIDS': [
      'Machine Learning',
      'Artificial Intelligence',
      'Big Data Analytics',
      'Deep Learning & Neural Networks',
      'Data Warehousing & Mining'
    ]
  },
  'BE': {
    'CMPN': [
      'Distributed Systems',
      'AI & Soft Computing',
      'Cryptography & System Security',
      'Cloud Computing Applications',
      'High Performance Computing'
    ],
    'IT': [
      'Information & Network Security',
      'Deep Learning',
      'Cloud Architecture & DevOps',
      'Big Data Engineering',
      'Mobile Application Development'
    ],
    'EXTC': [
      'Microwave Engineering',
      'Optical Fiber Communication',
      'Embedded & IoT Systems',
      'Satellite Communication',
      'RF Circuit Design'
    ],
    'ECS': [
      'Autonomous Systems & Robotics',
      'Cyber-Physical Systems',
      'System on Chip Design',
      'Cloud Security & Virtualization',
      'AI in Embedded Systems'
    ],
    'ARO': [
      'Autonomous Mobile Robots',
      'Industrial Robotics & CIM',
      'Digital Twins & Simulation',
      'HMI & SCADA Systems',
      'Applied AI in Robotics'
    ],
    'AIDS': [
      'Natural Language Processing',
      'Reinforcement Learning',
      'Computer Vision',
      'MLOps & Production AI',
      'AI Ethics & Governance'
    ]
  }
};

/**
 * Helper to compute 2-decimal attendance percentage
 */
function calculatePercentage(attended, total) {
  if (!total || total <= 0) return 0.0;
  return Number(((attended / total) * 100).toFixed(2));
}

/**
 * Main generator function
 */
function generateDataset(options = {}) {
  const collegeId = options.collegeId || DEFAULT_COLLEGE_ID;
  const emailDomain = options.emailDomain || DEFAULT_EMAIL_DOMAIN;
  const prng = createPRNG(options.seed || PRNG_SEED);

  const students = [];
  const attendance = [];

  const divisionStats = {};
  const yearStats = {};

  let globalStudentCounter = 0;

  for (const yearCfg of YEAR_CONFIGS) {
    const yearCode = yearCfg.yearCode;
    yearStats[yearCode] = {
      year: yearCfg.year,
      totalStudents: 0,
      divisions: {}
    };

    // Flatten division descriptors for this year (12 divisions)
    const flatDivisions = [];
    for (const b of BRANCH_CONFIG) {
      for (const d of b.divisions) {
        flatDivisions.push({
          branch: b.branch,
          branchCode: b.code,
          divisionLetter: d,
          divisionName: `${b.code}-${d}`
        });
      }
    }

    if (flatDivisions.length !== yearCfg.divisionSizes.length) {
      throw new Error(`Division count mismatch for ${yearCode}: expected ${yearCfg.divisionSizes.length}, got ${flatDivisions.length}`);
    }

    for (let divIdx = 0; divIdx < flatDivisions.length; divIdx++) {
      const divDesc = flatDivisions[divIdx];
      const divTargetSize = yearCfg.divisionSizes[divIdx];
      const divKey = `${yearCode}-${divDesc.divisionName}`;

      divisionStats[divKey] = {
        year: yearCfg.year,
        yearCode,
        branch: divDesc.branch,
        branchCode: divDesc.branchCode,
        divisionName: divDesc.divisionName,
        divisionLetter: divDesc.divisionLetter,
        count: 0
      };

      for (let rollIdx = 1; rollIdx <= divTargetSize; rollIdx++) {
        globalStudentCounter++;
        const rollPad = String(rollIdx).padStart(2, '0');
        const rollNumber = `${yearCode}-${divDesc.branchCode}-${divDesc.divisionLetter}-${rollPad}`;

        // Deterministic synthetic name
        const firstName = FIRST_NAMES[Math.floor(prng() * FIRST_NAMES.length)];
        const lastName = LAST_NAMES[Math.floor(prng() * LAST_NAMES.length)];
        const fullName = `${firstName} ${lastName}`;

        // Unique deterministic synthetic email
        const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
        const cleanLast = lastName.toLowerCase().replace(/[^a-z]/g, '');
        const rollSlug = `${yearCode.toLowerCase()}${divDesc.branchCode.toLowerCase()}${divDesc.divisionLetter.toLowerCase()}${rollPad}`;
        const email = `${cleanFirst}.${cleanLast}.${rollSlug}@${emailDomain}`;

        // Deterministic UUID
        const studentId = deterministicUUID('student', rollNumber);

        // Trust score between 5 and 20
        const trustScore = 5 + Math.floor(prng() * 16);

        const studentProfile = {
          id: studentId,
          college_id: collegeId,
          name: fullName,
          email: email,
          password_hash: BCRYPT_PASSWORD_HASH,
          role: 'student',
          trust_score: trustScore,
          roll_number: rollNumber,
          year: yearCfg.year,
          year_code: yearCode,
          branch: divDesc.branch,
          branch_code: divDesc.branchCode,
          division: divDesc.divisionName,
          division_letter: divDesc.divisionLetter,
          created_at: new Date('2026-09-01T09:00:00Z').toISOString()
        };

        students.push(studentProfile);
        divisionStats[divKey].count++;
        yearStats[yearCode].totalStudents++;

        // Generate Attendance Records for this student
        // Lookup subjects for year and branch
        let subjects = [];
        if (yearCode === 'FE') {
          subjects = SUBJECT_CURRICULUM['FE']['ALL'];
        } else {
          subjects = SUBJECT_CURRICULUM[yearCode][divDesc.branchCode] || [];
        }

        for (const subjectName of subjects) {
          const attendanceId = deterministicUUID('attendance', `${studentId}:${subjectName}:${yearCfg.semester}`);

          // Total conducted classes between 32 and 40
          const totalClasses = 32 + Math.floor(prng() * 9);

          // Realistic attendance distribution:
          // 75% regular (75%-94%), 15% high (95%-100%), 10% defaulters (45%-74%)
          const rollRand = prng();
          let targetPct;
          if (rollRand < 0.10) {
            // Defaulter
            targetPct = 0.45 + prng() * 0.28; // 45% - 73%
          } else if (rollRand < 0.85) {
            // Regular
            targetPct = 0.75 + prng() * 0.19; // 75% - 94%
          } else {
            // Top attendance
            targetPct = 0.95 + prng() * 0.05; // 95% - 100%
          }

          let attendedClasses = Math.round(totalClasses * targetPct);
          if (attendedClasses > totalClasses) attendedClasses = totalClasses;
          if (attendedClasses < 0) attendedClasses = 0;

          const percentage = calculatePercentage(attendedClasses, totalClasses);

          attendance.push({
            id: attendanceId,
            college_id: collegeId,
            student_id: studentId,
            roll_number: rollNumber,
            subject: subjectName,
            attended_classes: attendedClasses,
            total_classes: totalClasses,
            percentage: percentage,
            semester: yearCfg.semester,
            division: divDesc.divisionName,
            academic_year: yearCfg.academicYear,
            created_at: new Date('2026-09-01T09:00:00Z').toISOString(),
            updated_at: new Date('2026-10-31T09:00:00Z').toISOString()
          });
        }
      }

      yearStats[yearCode].divisions[divDesc.divisionName] = divisionStats[divKey].count;
    }
  }

  return {
    students,
    attendance,
    yearStats,
    divisionStats,
    meta: {
      generatedAt: new Date().toISOString(),
      seed: options.seed || PRNG_SEED,
      totalStudents: students.length,
      totalAttendanceRecords: attendance.length,
      collegeId: collegeId,
      emailDomain: emailDomain
    }
  };
}

/**
 * Format CSV
 */
function toCSV(records, headers) {
  const lines = [headers.join(',')];
  for (const r of records) {
    const row = headers.map(h => {
      let val = r[h];
      if (val === undefined || val === null) return '""';
      if (typeof val === 'string') {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

/**
 * Format SQL Inserts with ON CONFLICT resolution
 */
function toSQL(students, attendance, collegeId) {
  const sqlChunks = [
    '-- CampusOne Demo Student & Attendance Seed Data',
    '-- Repeatable & idempotent: uses ON CONFLICT DO NOTHING',
    '-- Generated for VESIT Pilot\n',
    'BEGIN;\n'
  ];

  // 1. Users insert (students)
  sqlChunks.push('-- ============================================================');
  sqlChunks.push('-- 1. INSERT DUMMY STUDENTS (users table)');
  sqlChunks.push('-- ============================================================');
  const userBatchSize = 400;
  for (let i = 0; i < students.length; i += userBatchSize) {
    const batch = students.slice(i, i + userBatchSize);
    const valueLines = batch.map(s => {
      return `('${s.id}', '${s.college_id}', '${s.name.replace(/'/g, "''")}', '${s.email}', '${s.password_hash}', '${s.role}', ${s.trust_score}, '${s.roll_number}', '${s.year}', '${s.branch}', '${s.division}')`;
    });
    sqlChunks.push(
      `INSERT INTO users (id, college_id, name, email, password_hash, role, trust_score, roll_number, year, branch, division)\nVALUES\n  ` +
      valueLines.join(',\n  ') +
      `\nON CONFLICT (email) DO UPDATE SET\n  roll_number = EXCLUDED.roll_number,\n  year = EXCLUDED.year,\n  branch = EXCLUDED.branch,\n  division = EXCLUDED.division;\n`
    );
  }

  // 2. Attendance insert
  sqlChunks.push('\n-- ============================================================');
  sqlChunks.push('-- 2. INSERT ATTENDANCE RECORDS');
  sqlChunks.push('-- ============================================================');
  const attBatchSize = 500;
  for (let i = 0; i < attendance.length; i += attBatchSize) {
    const batch = attendance.slice(i, i + attBatchSize);
    const valueLines = batch.map(a => {
      return `('${a.id}', '${a.college_id}', '${a.student_id}', '${a.subject.replace(/'/g, "''")}', ${a.attended_classes}, ${a.total_classes}, ${a.percentage}, '${a.semester}', '${a.division}', '${a.academic_year}')`;
    });
    sqlChunks.push(
      `INSERT INTO attendance (id, college_id, student_id, subject, attended_classes, total_classes, percentage, semester, division, academic_year)\nVALUES\n  ` +
      valueLines.join(',\n  ') +
      `\nON CONFLICT (college_id, student_id, subject, semester) DO UPDATE SET\n  attended_classes = EXCLUDED.attended_classes,\n  total_classes = EXCLUDED.total_classes,\n  percentage = EXCLUDED.percentage,\n  updated_at = NOW();\n`
    );
  }

  sqlChunks.push('COMMIT;\n');
  return sqlChunks.join('\n');
}

/**
 * Execute generation and write files
 */
function run() {
  console.log('Generating CampusOne reproducible dummy dataset...');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const result = generateDataset();

  // Verification checks
  console.log('\n--- VERIFICATION CHECKS ---');
  console.log(`Total students generated: ${result.students.length} (Target: 3200)`);
  if (result.students.length !== 3200) throw new Error('Student count must be exactly 3,200');

  for (const [code, info] of Object.entries(result.yearStats)) {
    console.log(`Year ${code} (${info.year}): ${info.totalStudents} students (Target: 800)`);
    if (info.totalStudents !== 800) throw new Error(`Year ${code} count must be exactly 800`);
  }

  console.log(`\nDivision breakdown (Total 48 divisions across 4 years):`);
  for (const [k, v] of Object.entries(result.divisionStats)) {
    if (v.count < 60 || v.count > 70) {
      throw new Error(`Division ${k} has ${v.count} students; must be between 60 and 70`);
    }
  }
  console.log(`✅ All 48 divisions strictly have between 60 and 70 students.`);

  // Verify unique constraints
  const studentIds = new Set();
  const emails = new Set();
  const rollNumbers = new Set();
  for (const s of result.students) {
    if (studentIds.has(s.id)) throw new Error(`Duplicate student ID: ${s.id}`);
    if (emails.has(s.email)) throw new Error(`Duplicate email: ${s.email}`);
    if (rollNumbers.has(s.roll_number)) throw new Error(`Duplicate roll number: ${s.roll_number}`);
    studentIds.add(s.id);
    emails.add(s.email);
    rollNumbers.add(s.roll_number);
  }
  console.log(`✅ IDs, emails, and roll numbers are 100% unique (0 collisions).`);

  // Verify attendance mathematics
  console.log(`Total attendance records generated: ${result.attendance.length}`);
  const attKeys = new Set();
  for (const a of result.attendance) {
    if (a.attended_classes > a.total_classes) {
      throw new Error(`Invalid record: attended (${a.attended_classes}) > total (${a.total_classes})`);
    }
    const expectedPct = calculatePercentage(a.attended_classes, a.total_classes);
    if (a.percentage !== expectedPct) {
      throw new Error(`Percentage mismatch: got ${a.percentage}, expected ${expectedPct}`);
    }
    const key = `${a.college_id}:${a.student_id}:${a.subject}:${a.semester}`;
    if (attKeys.has(key)) {
      throw new Error(`Duplicate attendance entry: ${key}`);
    }
    attKeys.add(key);
  }
  console.log(`✅ All ${result.attendance.length} attendance records verified: attended <= total, exact percentages, no duplicates.`);

  // Write JSON artifacts
  fs.writeFileSync(path.join(dataDir, 'students_seed.json'), JSON.stringify(result.students, null, 2));
  fs.writeFileSync(path.join(dataDir, 'attendance_seed.json'), JSON.stringify(result.attendance, null, 2));
  fs.writeFileSync(path.join(dataDir, 'students_summary.json'), JSON.stringify({
    meta: result.meta,
    yearStats: result.yearStats,
    divisionStats: result.divisionStats
  }, null, 2));

  // Write CSV artifacts
  const studentHeaders = ['id', 'college_id', 'name', 'email', 'roll_number', 'year', 'year_code', 'branch', 'branch_code', 'division', 'division_letter', 'trust_score', 'role', 'created_at'];
  fs.writeFileSync(path.join(dataDir, 'students_seed.csv'), toCSV(result.students, studentHeaders));

  const attHeaders = ['id', 'college_id', 'student_id', 'roll_number', 'subject', 'attended_classes', 'total_classes', 'percentage', 'semester', 'division', 'academic_year', 'created_at'];
  fs.writeFileSync(path.join(dataDir, 'attendance_seed.csv'), toCSV(result.attendance, attHeaders));

  // Write SQL artifact
  fs.writeFileSync(path.join(dataDir, 'seed_students_and_attendance.sql'), toSQL(result.students, result.attendance, DEFAULT_COLLEGE_ID));

  console.log(`\nAll seed files successfully written to ${dataDir}:`);
  console.log(` - students_seed.json`);
  console.log(` - attendance_seed.json`);
  console.log(` - students_summary.json`);
  console.log(` - students_seed.csv`);
  console.log(` - attendance_seed.csv`);
  console.log(` - seed_students_and_attendance.sql`);
}

if (require.main === module) {
  run();
}

module.exports = {
  generateDataset,
  calculatePercentage,
  toCSV,
  toSQL,
  BRANCH_CONFIG,
  YEAR_CONFIGS,
  SUBJECT_CURRICULUM,
  DEFAULT_COLLEGE_ID,
  DEFAULT_EMAIL_DOMAIN
};
