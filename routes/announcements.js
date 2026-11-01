const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 5000;

/**
 * Normalizes announcement object to support both backend contract ('body')
 * and Flutter client model ('content', 'category').
 */
function formatAnnouncement(item) {
  if (!item) return item;
  return {
    ...item,
    content: item.body,
    category: item.category || 'General'
  };
}

// GET /announcements
// Returns global announcements for the caller's college, ordered newest first.
// Supports optional pagination: ?limit=10&page=1
router.get('/', requireAuth, async (req, res) => {
  try {
    const { limit, page } = req.query;

    let query = supabase
      .from('announcements')
      .select('*')
      .eq('college_id', req.user.collegeId)
      .order('created_at', { ascending: false });

    if (limit !== undefined) {
      const parsedLimit = parseInt(limit, 10);
      if (isNaN(parsedLimit) || parsedLimit <= 0) {
        return res.status(400).json({ error: 'limit must be a positive integer' });
      }
      const safeLimit = Math.min(parsedLimit, 100);

      const parsedPage = page !== undefined ? parseInt(page, 10) : 1;
      if (isNaN(parsedPage) || parsedPage <= 0) {
        return res.status(400).json({ error: 'page must be a positive integer' });
      }

      const from = (parsedPage - 1) * safeLimit;
      const to = from + safeLimit - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ announcements: (data || []).map(formatAnnouncement) });
  } catch (err) {
    console.error('list announcements error', err);
    res.status(500).json({ error: 'Could not fetch announcements' });
  }
});

// POST /announcements
// Admin endpoint: Create announcement for caller's college.
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { title, body, content } = req.body || {};
    const rawBody = body !== undefined ? body : content;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required and cannot be empty' });
    }

    if (!rawBody || !rawBody.trim()) {
      return res.status(400).json({ error: 'body is required and cannot be empty' });
    }

    const trimmedTitle = title.trim();
    const trimmedBody = rawBody.trim();

    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `title cannot exceed ${MAX_TITLE_LENGTH} characters` });
    }

    if (trimmedBody.length > MAX_BODY_LENGTH) {
      return res.status(400).json({ error: `body cannot exceed ${MAX_BODY_LENGTH} characters` });
    }

    const { data, error } = await supabase
      .from('announcements')
      .insert({
        college_id: req.user.collegeId,
        title: trimmedTitle,
        body: trimmedBody
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ announcement: formatAnnouncement(data) });
  } catch (err) {
    console.error('create announcement error', err);
    res.status(500).json({ error: 'Could not create announcement' });
  }
});

// PATCH /announcements/:id
// Admin endpoint: Update announcement details.
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const announcementId = req.params.id;

    if (!UUID_REGEX.test(announcementId)) {
      return res.status(400).json({ error: 'Invalid announcement ID format' });
    }

    const { title, body, content } = req.body || {};
    const rawBody = body !== undefined ? body : content;

    const updates = {};

    if (title !== undefined) {
      if (!title || !title.trim()) {
        return res.status(400).json({ error: 'title cannot be empty' });
      }
      const trimmedTitle = title.trim();
      if (trimmedTitle.length > MAX_TITLE_LENGTH) {
        return res.status(400).json({ error: `title cannot exceed ${MAX_TITLE_LENGTH} characters` });
      }
      updates.title = trimmedTitle;
    }

    if (rawBody !== undefined) {
      if (!rawBody || !rawBody.trim()) {
        return res.status(400).json({ error: 'body cannot be empty' });
      }
      const trimmedBody = rawBody.trim();
      if (trimmedBody.length > MAX_BODY_LENGTH) {
        return res.status(400).json({ error: `body cannot exceed ${MAX_BODY_LENGTH} characters` });
      }
      updates.body = trimmedBody;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('announcements')
      .update(updates)
      .eq('id', announcementId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    res.json({ announcement: formatAnnouncement(data[0]) });
  } catch (err) {
    console.error('update announcement error', err);
    res.status(500).json({ error: 'Could not update announcement' });
  }
});

// DELETE /announcements/:id
// Admin endpoint: Delete announcement.
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const announcementId = req.params.id;

    if (!UUID_REGEX.test(announcementId)) {
      return res.status(400).json({ error: 'Invalid announcement ID format' });
    }

    const { data, error } = await supabase
      .from('announcements')
      .delete()
      .eq('id', announcementId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    res.json({ success: true, message: 'Announcement deleted successfully' });
  } catch (err) {
    console.error('delete announcement error', err);
    res.status(500).json({ error: 'Could not delete announcement' });
  }
});

module.exports = router;
