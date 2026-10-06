const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /events
router.get('/', requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('college_id', req.user.collegeId)
      .gte('date', today)
      .order('date', { ascending: true })
      .order('time', { ascending: true }); // Secondary order by time if available

    if (error) throw error;
    res.json({ events: data });
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

    // Verify event exists and belongs to user's college
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, college_id')
      .eq('id', eventId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Insert RSVP
    const { data, error } = await supabase
      .from('event_rsvps')
      .insert({
        event_id: eventId,
        user_id: req.user.id
      })
      .select()
      .single();

    if (error) {
      // Handle duplicate RSVP based on unique constraint (event_id, user_id)
      if (error.code === '23505') { // Postgres unique_violation
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

    // Verify event exists and belongs to user's college
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, college_id')
      .eq('id', eventId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get RSVP count
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
