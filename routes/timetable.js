const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /timetable
// Returns timetable rows for the caller's college (+ optional division filter)
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = supabase
      .from('timetable')
      .select('*')
      .eq('college_id', req.user.collegeId)
      .order('day')
      .order('start_time');

    if (req.query.division) {
      query = query.eq('division', req.query.division);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ timetable: data });
  } catch (err) {
    console.error('get timetable error', err);
    res.status(500).json({ error: 'Could not fetch timetable' });
  }
});

// POST /timetable  (admin only)
// body: { division, subject, day, start_time, end_time, room }
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { division, subject, day, start_time, end_time, room } = req.body;
    if (!division || !subject || !day || !start_time || !end_time) {
      return res.status(400).json({ error: 'division, subject, day, start_time, end_time are required' });
    }

// Basic time validation: end_time must be after start_time
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(start_time) || !timeRegex.test(end_time)) {
      return res.status(400).json({ error: 'Invalid time format. Use HH:mm (24-hour format)' });
    }
    if (start_time >= end_time) {
      return res.status(400).json({ error: 'end_time must be after start_time' });
    }

    const { data, error } = await supabase
      .from('timetable')
      .insert({
        college_id: req.user.collegeId,
        division,
        subject,
        day,
        start_time,
        end_time,
        room
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ entry: data });
  } catch (err) {
    console.error('post timetable error', err);
    res.status(500).json({ error: 'Could not create timetable entry' });
  }
});

// PATCH /timetable/:id (admin only)
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { division, subject, day, start_time, end_time, room } = req.body;

    const updates = {};
    if (division !== undefined) updates.division = division;
    if (subject !== undefined) updates.subject = subject;
    if (day !== undefined) updates.day = day;
    if (start_time !== undefined) updates.start_time = start_time;
    if (end_time !== undefined) updates.end_time = end_time;
    if (room !== undefined) updates.room = room;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Time validation
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (updates.start_time && !timeRegex.test(updates.start_time)) {
      return res.status(400).json({ error: 'Invalid start_time format. Use HH:mm' });
    }
    if (updates.end_time && !timeRegex.test(updates.end_time)) {
      return res.status(400).json({ error: 'Invalid end_time format. Use HH:mm' });
    }

    // Strict time ordering: if either time is updated, verify against the final value
    // We fetch the current record to get the existing times if one is missing from updates
    const { data: currentEntry, error: fetchError } = await supabase
      .from('timetable')
      .select('start_time, end_time')
      .eq('id', id)
      .eq('college_id', req.user.collegeId)
      .single();

    if (fetchError || !currentEntry) {
      return res.status(404).json({ error: 'Timetable entry not found' });
    }

    const finalStartTime = updates.start_time || currentEntry.start_time;
    const finalEndTime = updates.end_time || currentEntry.end_time;

    if (finalStartTime >= finalEndTime) {
      return res.status(400).json({ error: 'end_time must be after start_time' });
    }

    const { data, error } = await supabase
      .from('timetable')
      .update(updates)
      .eq('id', id)
      .eq('college_id', req.user.collegeId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Timetable entry not found' });

    res.json({ entry: data });
  } catch (err) {
    console.error('update timetable error', err);
    res.status(500).json({ error: 'Could not update timetable entry' });
  }
});

// DELETE /timetable/:id (admin only)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('timetable')
      .delete()
      .eq('id', id)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Timetable entry not found' });
    }

    res.json({ success: true, message: 'Timetable entry deleted successfully' });
  } catch (err) {
    console.error('delete timetable error', err);
    res.status(500).json({ error: 'Could not delete timetable entry' });
  }
});

module.exports = router;
