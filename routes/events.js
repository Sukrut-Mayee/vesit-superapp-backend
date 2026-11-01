const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Helper for calendar date validation
function isValidDate(dateString) {
  const regex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  if (!regex.test(dateString)) return false;
  const [year, month, day] = dateString.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

// Helper for time validation
function isValidTime(timeString) {
  const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  return regex.test(timeString);
}

// GET /events
router.get('/', requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('events')
      .select('*, event_rsvps(user_id)')
      .eq('college_id', req.user.collegeId)
      .gte('date', today)
      .order('date', { ascending: true })
      .order('time', { ascending: true });

    if (error) throw error;
    const events = (data || []).map(({ event_rsvps: rsvps = [], ...event }) => ({
      ...event,
      rsvp_count: rsvps.length,
      has_rsvpd: rsvps.some(rsvp => rsvp.user_id === req.user.id)
    }));
    res.json({ events });
  } catch (err) {
    console.error('list events error', err);
    res.status(500).json({ error: 'Could not fetch events' });
  }
});

// POST /events
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { title, description, date, time, venue } = req.body;

    if (!title || !date) {
      return res.status(400).json({ error: 'title and date are required' });
    }

    if (!isValidDate(date)) {
      return res.status(400).json({ error: 'Invalid calendar date. Use YYYY-MM-DD' });
    }

    if (time && !isValidTime(time)) {
      return res.status(400).json({ error: 'Invalid time format. Use HH:mm (24-hour format)' });
    }

    const today = new Date().toISOString().split('T')[0];
    if (date < today) {
      return res.status(400).json({ error: 'Event date cannot be in the past' });
    }

    const { data, error } = await supabase
      .from('events')
      .insert({
        college_id: req.user.collegeId,
        title,
        description: description || null,
        date,
        time: time || null,
        venue: venue || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ event: data });
  } catch (err) {
    console.error('create event error', err);
    res.status(500).json({ error: 'Could not create event' });
  }
});

// POST /events/:id/rsvp
router.post('/:id/rsvp', requireAuth, async (req, res) => {
  try {
    const eventId = req.params.id;

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, college_id')
      .eq('id', eventId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const { data, error } = await supabase
      .from('event_rsvps')
      .insert({
        event_id: eventId,
        user_id: req.user.id
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Already RSVPed to this event' });
      }
      throw error;
    }

    res.status(201).json({ rsvp: data });
  } catch (err) {
    console.error('rsvp event error', err);
    res.status(500).json({ error: 'Could not RSVP to event' });
  }
});

// GET /events/:id/rsvp-count
router.get('/:id/rsvp-count', requireAuth, async (req, res) => {
  try {
    const eventId = req.params.id;

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, college_id')
      .eq('id', eventId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const { count, error } = await supabase
      .from('event_rsvps')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId);

    if (error) throw error;

    res.json({
      event_id: eventId,
      count: count
    });
  } catch (err) {
    console.error('rsvp count error', err);
    res.status(500).json({ error: 'Could not fetch RSVP count' });
  }
});

// PATCH /events/:id
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const eventId = req.params.id;
    const { title, description, date, time, venue } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (date !== undefined) updates.date = date;
    if (time !== undefined) updates.time = time;
    if (venue !== undefined) updates.venue = venue;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Fetch current record to validate final state
    const { data: currentEvent, error: fetchError } = await supabase
      .from('events')
      .select('date, time')
      .eq('id', eventId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (fetchError || !currentEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const finalDate = updates.date || currentEvent.date;
    const finalTime = updates.time !== undefined ? updates.time : currentEvent.time;

    if (!isValidDate(finalDate)) {
      return res.status(400).json({ error: 'Invalid calendar date. Use YYYY-MM-DD' });
    }

    if (finalTime && !isValidTime(finalTime)) {
      return res.status(400).json({ error: 'Invalid time format. Use HH:mm (24-hour format)' });
    }

    const today = new Date().toISOString().split('T')[0];
    if (finalDate < today) {
      return res.status(400).json({ error: 'Event date cannot be in the past' });
    }

    const { data, error } = await supabase
      .from('events')
      .update(updates)
      .eq('id', eventId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ event: data[0] });
  } catch (err) {
    console.error('update event error', err);
    res.status(500).json({ error: 'Could not update event' });
  }
});

// DELETE /events/:id
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const eventId = req.params.id;

    const { data, error } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ success: true, message: 'Event deleted successfully' });
  } catch (err) {
    console.error('delete event error', err);
    res.status(500).json({ error: 'Could not delete event' });
  }
});

module.exports = router;
