const express = require('express');
const path = require('path');
const multer = require('multer');
const supabase = require('../services/supabase');
const {
  uploadToCloudinary,
  deleteFromCloudinary,
  isValidImageSignature,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_IMAGE_EXTS
} = require('../services/cloudinary');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Memory storage for direct stream to Cloudinary with MIME validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB cap
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_IMAGE_MIMES.has(mime) && !ALLOWED_IMAGE_EXTS.has(ext)) {
      const err = new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF images are allowed.');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    cb(null, true);
  }
});

/**
 * Wraps upload.single('photo') with structured error responses for Multer errors
 */
const uploadPhotoMiddleware = (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum allowed size is 20 MB.' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          error: `Unexpected field "${err.field}". Lost & Found photos must use the "photo" field.`
        });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err.code === 'INVALID_FILE_TYPE') {
      return res.status(400).json({ error: err.message });
    }
    return res.status(400).json({ error: err.message || 'Invalid upload request' });
  });
};

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
router.post('/', requireAuth, uploadPhotoMiddleware, async (req, res) => {
  let uploadedPublicId = null;
  try {
    const { type, description } = req.body;

    if (!type || !description || !description.trim()) {
      return res.status(400).json({ error: 'type and description are required' });
    }

    const trimmedType = type.trim().toLowerCase();
    if (trimmedType !== 'lost' && trimmedType !== 'found') {
      return res.status(400).json({ error: 'type must be exactly "lost" or "found"' });
    }

    let photoUrl = null;
    if (req.file) {
      // Validate magic bytes to prevent forged file extensions
      if (!isValidImageSignature(req.file.buffer)) {
        return res.status(400).json({
          error: 'Invalid image file content. File does not match a supported image signature.'
        });
      }

      // Stream to Cloudinary
      const uploaded = await uploadToCloudinary(req.file.buffer, 'campusone/lost-found', 'image');
      photoUrl = uploaded.url;
      uploadedPublicId = uploaded.publicId;
    }

    const { data, error } = await supabase
      .from('lost_found')
      .insert({
        college_id: req.user.collegeId,
        poster_id: req.user.id,
        type: trimmedType,
        description: description.trim(),
        photo_url: photoUrl,
        status: 'open'
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ listing: data });
  } catch (err) {
    console.error('create lost-found error', err);
    // Rollback newly uploaded asset if database persistence fails
    if (uploadedPublicId) {
      await deleteFromCloudinary(uploadedPublicId, 'image').catch((cleanupErr) => {
        console.error('[LostFound] Rollback failed after DB error:', cleanupErr.message || cleanupErr);
      });
    }
    if (err.code === 'CLOUDINARY_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Image upload service is temporarily unavailable.' });
    }
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

    // Resolution belongs to the original poster, regardless of role.
    if (listing.poster_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the person who posted this listing can resolve it' });
    }
    if (listing.status === 'resolved') return res.json({ listing });

    // Keep both tenant and owner constraints on the write itself.
    const { data, error } = await supabase
      .from('lost_found')
      .update({ status: 'resolved' })
      .eq('id', listingId)
      .eq('college_id', req.user.collegeId)
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
