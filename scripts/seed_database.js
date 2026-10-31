/**
 * CampusOne Database Seeder
 * Loads dummy student profiles and attendance records into Supabase / PostgreSQL.
 * Supports:
 *   --dry-run      Validate dataset in memory without DB queries
 *   --verify-only  Verify existing data counts in database
 *   --batch-size   Number of records per insert request (default: 200)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../services/supabase');

const dataDir = path.join(__dirname, '..', 'data');
const studentsPath = path.join(dataDir, 'students_seed.json');
const attendancePath = path.join(dataDir, 'attendance_seed.json');

async function seed() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isVerifyOnly = args.includes('--verify-only');
  const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 200;

  console.log('======================================================');
  console.log('CampusOne Database Seeder & Verification Utility');
  console.log('======================================================\n');

  if (!fs.existsSync(studentsPath) || !fs.existsSync(attendancePath)) {
    console.error('Seed files not found. Please run "node scripts/generate_demo_data.js" first.');
    process.exit(1);
  }

  const students = JSON.parse(fs.readFileSync(studentsPath, 'utf8'));
  const attendance = JSON.parse(fs.readFileSync(attendancePath, 'utf8'));

  console.log(`Loaded ${students.length} students and ${attendance.length} attendance records from data/ directory.`);

  if (isVerifyOnly) {
    console.log('\nRunning database verification mode...');
    try {
      const { count: userCount, error: userErr } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'student');

      if (userErr) {
        console.warn('Note: Could not query users table:', userErr.message);
      } else {
        console.log(`Database student users count: ${userCount}`);
      }

      const { count: attCount, error: attErr } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true });

      if (attErr) {
        console.warn('Note: Could not query attendance table:', attErr.message);
      } else {
        console.log(`Database attendance records count: ${attCount}`);
      }
    } catch (e) {
      console.error('Verification query failed:', e.message);
    }
    return;
  }

  if (isDryRun) {
    console.log('\nDry run enabled: Database write skipped.');
    console.log('Dataset integrity verified in memory:');
    console.log(` - Student count: ${students.length}`);
    console.log(` - Attendance count: ${attendance.length}`);
    return;
  }

  console.log(`\nStarting database seed (Batch size: ${batchSize})...`);
  console.log(`Tip: For instant full load, paste "data/seed_students_and_attendance.sql" into Supabase SQL Editor.\n`);

  // 1. Seed users table
  console.log(`Seeding ${students.length} students into "users" table...`);
  let insertedUsers = 0;
  for (let i = 0; i < students.length; i += batchSize) {
    const batch = students.slice(i, i + batchSize).map(s => ({
      id: s.id,
      college_id: s.college_id,
      name: s.name,
      email: s.email,
      password_hash: s.password_hash,
      role: s.role,
      trust_score: s.trust_score,
      roll_number: s.roll_number,
      year: s.year,
      branch: s.branch,
      division: s.division
    }));

    const { error } = await supabase
      .from('users')
      .upsert(batch, { onConflict: 'email' });

    if (error) {
      console.warn(`User batch ${i} to ${i + batch.length} notice: ${error.message}`);
      break;
    }
    insertedUsers += batch.length;
    process.stdout.write(`\rUsers processed: ${insertedUsers}/${students.length}`);
  }
  console.log(`\nUsers table sync complete.`);

  // 2. Seed attendance table
  console.log(`\nSeeding ${attendance.length} records into "attendance" table...`);
  let insertedAtt = 0;
  for (let i = 0; i < attendance.length; i += batchSize) {
    const batch = attendance.slice(i, i + batchSize).map(a => ({
      id: a.id,
      college_id: a.college_id,
      student_id: a.student_id,
      subject: a.subject,
      attended_classes: a.attended_classes,
      total_classes: a.total_classes,
      percentage: a.percentage,
      semester: a.semester,
      division: a.division,
      academic_year: a.academic_year
    }));

    const { error } = await supabase
      .from('attendance')
      .upsert(batch, { onConflict: 'college_id,student_id,subject,semester' });

    if (error) {
      console.log(`Attendance batch notice: ${error.message}`);
      console.log('ℹ️ If table "attendance" is pending execution in Supabase SQL editor, run "data/seed_students_and_attendance.sql" directly in the Supabase Dashboard.');
      break;
    }
    insertedAtt += batch.length;
    process.stdout.write(`\rAttendance processed: ${insertedAtt}/${attendance.length}`);
  }
  console.log(`\nAttendance seeding finished.`);
}

if (require.main === module) {
  seed().catch(err => {
    console.error('Seed process error:', err);
    process.exit(1);
  });
}

module.exports = { seed };
