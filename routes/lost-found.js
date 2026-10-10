const express = require('express');
const multer = require('multer');
const supabase = require('../services/supabase');
const { uploadToCloudinary } = require('../services/cloudinary');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Memory storage for direct stream to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB cap
});

// GET /lost-found
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = supabase
      .from('lost_found')
      .select('*')
      .eq('college_id', req.user.collegeId)
      .order('created_at', { ascending: false });

    const status = req.query.status || 'open';
    if (!['open', 'resolved', 'all'].includes(status)) {
      return res.status(400).json({ error: 'status must be open, resolved or all' });
    }
    if (status !== 'all') query = query.eq('status', status);

    const { type } = req.query;
    if (type) {
      if (type !== 'lost' && type !== 'found') {
        return res.status(400).json({ error: 'type must be exactly "lost" or "found"' });
      }
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ listings: data });
  } catch (err) {
    console.error('list lost-found error', err);
    res.status(500).json({ error: 'Could not fetch listings' });
  }
});

// POST /lost-found (multipart/form-data: type, description, [photo])
router.post('/', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { type, description } = req.body;

    if (!type || !description) {
      return res.status(400).json({ error: 'type and description are required' });
    }
    
    if (type !== 'lost' && type !== 'found') {
      return res.status(400).json({ error: 'type must be exactly "lost" or "found"' });
    }

    let photoUrl = null;
    if (req.file) {
      // Upload to Cloudinary using the existing pattern
      const uploaded = await uploadToCloudinary(req.file.buffer, 'campusone/lost-found');
      photoUrl = uploaded.url;
    }

    const { data, error } = await supabase
      .from('lost_found')
      .insert({
        college_id: req.user.collegeId,
        poster_id: req.user.id,
        type,
        description,
        photo_url: photoUrl,
        status: 'open'
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ listing: data });
  } catch (err) {
    console.error('create lost-found error', err);
    res.status(500).json({ error: 'Could not create listing' });
  }
});

// PATCH /lost-found/:id/resolve
router.patch('/:id/resolve', requireAuth, async (req, res) => {
  try {
    const listingId = req.params.id;

    // Fetch the listing and ensure it belongs to the user's college
    const { data: listing, error: listingError } = await supabase
      .from('lost_found')
      .select('id, college_id, poster_id, status')
      .eq('id', listingId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (listingError || !listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Only the reporter can confirm recovery or handover. Moderation is separate.
    if (listing.poster_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the person who posted this listing can resolve it' });
    }
    if (listing.status === 'resolved') return res.json({ listing });

    // Mark as resolved
    const { data, error } = await supabase
      .from('lost_found')
      .update({ status: 'resolved' })
      .eq('id', listingId)
      .eq('college_id', req.user.collegeId) // Extra safety check
      .eq('poster_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ listing: data });
  } catch (err) {
    console.error('resolve lost-found error', err);
    res.status(500).json({ error: 'Could not resolve listing' });
  }
});

// DELETE /lost-found/:id (Moderation)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const listingId = req.params.id;

    const { data, error } = await supabase
      .from('lost_found')
      .delete()
      .eq('id', listingId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    res.json({ success: true, message: 'Listing deleted successfully' });
  } catch (err) {
    console.error('delete lost-found error', err);
    res.status(500).json({ error: 'Could not delete listing' });
  }
});

module.exports = router;
