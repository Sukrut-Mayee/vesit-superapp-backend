const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Helper to compute attendance percentage with 2 decimal precision.
 * @param {number} attended
 * @param {number} total
 * @returns {number}
 */
function calculatePercentage(attended, total) {
  if (!total || total <= 0) return 0.0;
  return Number(((attended / total) * 100).toFixed(2));
}

/**
 * GET /attendance/me
 * Returns attendance breakdown and cumulative metrics for the logged-in student.
 * Optional query params: semester, academic_year
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { semester, academic_year } = req.query;

    let query = supabase
      .from('attendance')
      .select('*')
      .eq('student_id', req.user.id)
      .eq('college_id', req.user.collegeId)
      .order('subject', { ascending: true });

    if (semester) {
      query = query.eq('semester', semester);
    }
    if (academic_year) {
      query = query.eq('academic_year', academic_year);
    }

    const { data, error } = await query;
    if (error) throw error;

    const records = data || [];
    let totalAttended = 0;
    let totalConducted = 0;
    let lowAttendanceSubjects = 0;

    for (const record of records) {
      totalAttended += Number(record.attended_classes || 0);
      totalConducted += Number(record.total_classes || 0);
      if (Number(record.percentage || 0) < 75.0) {
        lowAttendanceSubjects += 1;
      }
    }

    const overallPercentage = calculatePercentage(totalAttended, totalConducted);

    res.json({
      attendance: records,
      summary: {
        total_subjects: records.length,
        total_attended_classes: totalAttended,
        total_conducted_classes: totalConducted,
        overall_percentage: overallPercentage,
        low_attendance_subjects_count: lowAttendanceSubjects,
        is_defaulter: overallPercentage < 75.0 && records.length > 0
      }
    });
  } catch (err) {
    console.error('get my attendance error', err);
    res.status(500).json({ error: 'Could not fetch attendance records' });
  }
});

/**
 * GET /attendance/me/:subject
 * Returns attendance for a specific subject for the logged-in student.
 */
router.get('/me/:subject', requireAuth, async (req, res) => {
  try {
    const { subject } = req.params;
    const { semester } = req.query;

    let query = supabase
      .from('attendance')
      .select('*')
      .eq('student_id', req.user.id)
      .eq('college_id', req.user.collegeId)
      .ilike('subject', subject);

    if (semester) {
      query = query.eq('semester', semester);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: `No attendance record found for subject "${subject}"` });
    }

    res.json({ attendance: data });
  } catch (err) {
    console.error('get subject attendance error', err);
    res.status(500).json({ error: 'Could not fetch subject attendance' });
  }
});

/**
 * GET /attendance
 * Admin view: list attendance records with optional filters (division, semester, subject, student_id).
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { division, semester, subject, student_id, academic_year } = req.query;

    let query = supabase
      .from('attendance')
      .select(`
        *,
        student:users!attendance_student_id_fkey (
          id,
          name,
          email,
          role
        )
      `)
      .eq('college_id', req.user.collegeId)
      .order('created_at', { ascending: false });

    if (division) query = query.eq('division', division);
    if (semester) query = query.eq('semester', semester);
    if (subject) query = query.ilike('subject', `%${subject}%`);
    if (student_id) query = query.eq('student_id', student_id);
    if (academic_year) query = query.eq('academic_year', academic_year);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ attendance: data || [] });
  } catch (err) {
    console.error('list attendance error', err);
    res.status(500).json({ error: 'Could not fetch attendance list' });
  }
});

/**
 * GET /attendance/student/:student_id
 * Admin view (or student viewing own): retrieve attendance summary for a specific student.
 */
router.get('/student/:student_id', requireAuth, async (req, res) => {
  try {
    const { student_id } = req.params;
    const { semester } = req.query;

    if (req.user.role !== 'admin' && req.user.id !== student_id) {
      return res.status(403).json({ error: 'Forbidden — you can only access your own attendance' });
    }

    // Verify student belongs to caller's college
    const { data: student, error: studentErr } = await supabase
      .from('users')
      .select('id, name, email, college_id')
      .eq('id', student_id)
      .eq('college_id', req.user.collegeId)
      .maybeSingle();

    if (studentErr || !student) {
      return res.status(404).json({ error: 'Student not found in your college' });
    }

    let query = supabase
      .from('attendance')
      .select('*')
      .eq('student_id', student_id)
      .eq('college_id', req.user.collegeId)
      .order('subject', { ascending: true });

    if (semester) {
      query = query.eq('semester', semester);
    }

    const { data, error } = await query;
    if (error) throw error;

    const records = data || [];
    let totalAttended = 0;
    let totalConducted = 0;

    for (const record of records) {
      totalAttended += Number(record.attended_classes || 0);
      totalConducted += Number(record.total_classes || 0);
    }

    const overallPercentage = calculatePercentage(totalAttended, totalConducted);

    res.json({
      student,
      attendance: records,
      summary: {
        total_subjects: records.length,
        total_attended_classes: totalAttended,
        total_conducted_classes: totalConducted,
        overall_percentage: overallPercentage,
        is_defaulter: overallPercentage < 75.0 && records.length > 0
      }
    });
  } catch (err) {
    console.error('get student attendance error', err);
    res.status(500).json({ error: 'Could not fetch student attendance' });
  }
});

/**
 * POST /attendance
 * Admin endpoint: Create or upsert attendance record for a student.
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const {
      student_id,
      subject,
      attended_classes,
      total_classes,
      semester,
      division,
      academic_year
    } = req.body;

    if (!student_id || !subject || attended_classes === undefined || total_classes === undefined) {
      return res.status(400).json({
        error: 'student_id, subject, attended_classes, and total_classes are required'
      });
    }

    const attended = Number(attended_classes);
    const total = Number(total_classes);

    if (isNaN(attended) || isNaN(total) || attended < 0 || total < 0) {
      return res.status(400).json({
        error: 'attended_classes and total_classes must be non-negative numbers'
      });
    }

    // Backend validation: attended cannot exceed total
    if (attended > total) {
      return res.status(400).json({
        error: 'Validation failed: attended_classes cannot exceed total_classes'
      });
    }

    // Verify student exists and belongs to this college
    const { data: studentUser, error: studentError } = await supabase
      .from('users')
      .select('id, college_id')
      .eq('id', student_id)
      .eq('college_id', req.user.collegeId)
      .maybeSingle();

    if (studentError || !studentUser) {
      return res.status(404).json({ error: 'Student does not exist or does not belong to your college' });
    }

    // Calculate percentage on backend
    const percentage = calculatePercentage(attended, total);

    const newRecord = {
      college_id: req.user.collegeId,
      student_id,
      subject: subject.trim(),
      attended_classes: attended,
      total_classes: total,
      percentage,
      semester: semester || null,
      division: division || null,
      academic_year: academic_year || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('attendance')
      .insert(newRecord)
      .select(`
        *,
        student:users!attendance_student_id_fkey (
          id,
          name,
          email
        )
      `)
      .single();

    if (error) throw error;

    res.status(201).json({ attendance: data });
  } catch (err) {
    console.error('create attendance error', err);
    res.status(500).json({ error: 'Could not create attendance record' });
  }
});

/**
 * PATCH /attendance/:id
 * Admin endpoint: Update existing attendance record.
 */
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const attendanceId = req.params.id;

    // 1. Fetch existing record and verify college isolation
    const { data: existing, error: findError } = await supabase
      .from('attendance')
      .select('*')
      .eq('id', attendanceId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: 'Attendance record not found in your college' });
    }

    const {
      subject,
      attended_classes,
      total_classes,
      semester,
      division,
      academic_year
    } = req.body;

    const newAttended = attended_classes !== undefined ? Number(attended_classes) : Number(existing.attended_classes);
    const newTotal = total_classes !== undefined ? Number(total_classes) : Number(existing.total_classes);

    if (isNaN(newAttended) || isNaN(newTotal) || newAttended < 0 || newTotal < 0) {
      return res.status(400).json({
        error: 'attended_classes and total_classes must be non-negative numbers'
      });
    }

    // Backend validation: attended cannot exceed total
    if (newAttended > newTotal) {
      return res.status(400).json({
        error: 'Validation failed: attended_classes cannot exceed total_classes'
      });
    }

    const updates = {
      updated_at: new Date().toISOString()
    };

    if (subject !== undefined) updates.subject = subject.trim();
    if (attended_classes !== undefined) updates.attended_classes = newAttended;
    if (total_classes !== undefined) updates.total_classes = newTotal;
    if (semester !== undefined) updates.semester = semester;
    if (division !== undefined) updates.division = division;
    if (academic_year !== undefined) updates.academic_year = academic_year;

    // Recalculate percentage on backend
    updates.percentage = calculatePercentage(newAttended, newTotal);

    const { data: updated, error: updateError } = await supabase
      .from('attendance')
      .update(updates)
      .eq('id', attendanceId)
      .eq('college_id', req.user.collegeId)
      .select(`
        *,
        student:users!attendance_student_id_fkey (
          id,
          name,
          email
        )
      `)
      .single();

    if (updateError) throw updateError;

    res.json({ attendance: updated });
  } catch (err) {
    console.error('update attendance error', err);
    res.status(500).json({ error: 'Could not update attendance record' });
  }
});

/**
 * POST /attendance/bulk
 * Admin endpoint: Bulk import/update attendance records (e.g. for a class/division).
 */
router.post('/bulk', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const records = Array.isArray(req.body) ? req.body : req.body.records;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array is required and cannot be empty' });
    }

    const sanitizedRecords = [];

    for (let i = 0; i < records.length; i++) {
      const item = records[i];
      if (!item.student_id || !item.subject || item.attended_classes === undefined || item.total_classes === undefined) {
        return res.status(400).json({
          error: `Record at index ${i} is missing required fields (student_id, subject, attended_classes, total_classes)`
        });
      }

      const attended = Number(item.attended_classes);
      const total = Number(item.total_classes);

      if (isNaN(attended) || isNaN(total) || attended < 0 || total < 0) {
        return res.status(400).json({
          error: `Record at index ${i} has invalid numbers for attended_classes or total_classes`
        });
      }

      if (attended > total) {
        return res.status(400).json({
          error: `Record at index ${i} invalid: attended_classes (${attended}) cannot exceed total_classes (${total})`
        });
      }

      sanitizedRecords.push({
        college_id: req.user.collegeId,
        student_id: item.student_id,
        subject: item.subject.trim(),
        attended_classes: attended,
        total_classes: total,
        percentage: calculatePercentage(attended, total),
        semester: item.semester || null,
        division: item.division || null,
        academic_year: item.academic_year || null,
        updated_at: new Date().toISOString()
      });
    }

    const { data, error } = await supabase
      .from('attendance')
      .upsert(sanitizedRecords, {
        onConflict: 'college_id,student_id,subject,semester'
      })
      .select();

    if (error) {
      // If composite unique index is not yet applied, fallback to insert
      const { data: insertData, error: insertError } = await supabase
        .from('attendance')
        .insert(sanitizedRecords)
        .select();

      if (insertError) throw insertError;
      return res.status(201).json({
        success: true,
        count: insertData.length,
        records: insertData
      });
    }

    res.status(201).json({
      success: true,
      count: data.length,
      records: data
    });
  } catch (err) {
    console.error('bulk attendance error', err);
    res.status(500).json({ error: 'Could not process bulk attendance import' });
  }
});

/**
 * DELETE /attendance/:id
 * Admin endpoint: Delete an attendance entry.
 */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const attendanceId = req.params.id;

    const { data: existing, error: findError } = await supabase
      .from('attendance')
      .select('id, college_id')
      .eq('id', attendanceId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: 'Attendance record not found in your college' });
    }

    const { error: deleteError } = await supabase
      .from('attendance')
      .delete()
      .eq('id', attendanceId)
      .eq('college_id', req.user.collegeId);

    if (deleteError) throw deleteError;

    res.json({ success: true, message: 'Attendance record deleted successfully' });
  } catch (err) {
    console.error('delete attendance error', err);
    res.status(500).json({ error: 'Could not delete attendance record' });
  }
});

module.exports = router;
