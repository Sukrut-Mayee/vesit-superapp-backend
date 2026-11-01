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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB cap per file
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
 * Wraps upload.array('images', 5) with structured error responses for Multer errors
 */
const uploadImagesMiddleware = (req, res, next) => {
  upload.array('images', 5)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum allowed size is 20 MB per file.' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          error: `Upload error: Maximum 5 images allowed, or unexpected field "${err.field}". Resource images must use the "images" field.`
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

// GET /resources
// Returns resources for the authenticated user's college.
// Supports filters: category, listing_type, status, search (or query).
// Defaults to status='AVAILABLE' if no status filter is provided.
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category, listing_type, status, search, query: searchQuery } = req.query;

    let query = supabase
      .from('resources')
      .select(`
        *,
        owner:users!resources_owner_id_fkey (
          id,
          name,
          email,
          trust_score
        )
      `)
      .eq('college_id', req.user.collegeId)
      .order('created_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }
    if (listing_type) {
      query = query.eq('listing_type', listing_type);
    }
    if (status && status !== 'all') {
      query = query.eq('status', status);
    } else if (!status) {
      // Default to AVAILABLE for marketplace browsing
      query = query.eq('status', 'AVAILABLE');
    }

    const searchTerm = search || searchQuery;
    if (searchTerm) {
      query = query.ilike('title', `%${searchTerm}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ resources: data });
  } catch (err) {
    console.error('list resources error', err);
    res.status(500).json({ error: 'Could not fetch resources' });
  }
});

// GET /resources/:id
// Returns detailed info for a single resource with owner profile
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const resourceId = req.params.id;

    const { data: resource, error } = await supabase
      .from('resources')
      .select(`
        *,
        owner:users!resources_owner_id_fkey (
          id,
          name,
          email,
          trust_score
        )
      `)
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (error || !resource) {
      return res.status(404).json({ error: 'Resource not found or does not belong to your college' });
    }

    res.json({ resource });
  } catch (err) {
    console.error('get resource detail error', err);
    res.status(500).json({ error: 'Could not fetch resource details' });
  }
});

// POST /resources
// Allowed role: student or admin
// Supports multipart/form-data (files in 'images') and application/json (image_urls array)
router.post('/', requireAuth, uploadImagesMiddleware, async (req, res) => {
  const newUploads = [];
  let createdResourceId = null;
  try {
    let { title, category, condition, listing_type, image_urls } = req.body;

    // Validation
    if (!title || !category || !listing_type) {
      return res.status(400).json({ error: 'title, category and listing_type are required' });
    }

    if (!['lend', 'donate'].includes(listing_type)) {
      return res.status(400).json({ error: 'listing_type must be either "lend" or "donate"' });
    }

    let finalImageUrls = [];

    // Parse image_urls if provided in body
    if (image_urls) {
      if (typeof image_urls === 'string') {
        try {
          finalImageUrls = JSON.parse(image_urls);
        } catch (e) {
          if (image_urls.trim()) finalImageUrls = [image_urls.trim()];
        }
      } else if (Array.isArray(image_urls)) {
        finalImageUrls = [...image_urls];
      }
    }

    // Process uploaded image files
    if (req.files && req.files.length > 0) {
      if (req.files.length > 5) {
        return res.status(400).json({ error: 'Maximum 5 images allowed per resource.' });
      }

      // 1. Verify signatures of all files BEFORE starting any upload
      for (const file of req.files) {
        if (!isValidImageSignature(file.buffer)) {
          return res.status(400).json({
            error: `File "${file.originalname}" does not have valid image content.`
          });
        }
      }

      // 2. Stream to Cloudinary
      for (const file of req.files) {
        const uploaded = await uploadToCloudinary(file.buffer, 'campusone/resources', 'image');
        newUploads.push(uploaded);
        finalImageUrls.push(uploaded.url);
      }
    }

    // Insert resource record into Supabase
    const { data: resource, error } = await supabase
      .from('resources')
      .insert({
        college_id: req.user.collegeId,
        owner_id: req.user.id,
        title: title.trim(),
        category: category.trim(),
        condition: condition ? condition.trim() : null,
        listing_type,
        status: 'AVAILABLE',
        image_urls: finalImageUrls
      })
      .select(`
        *,
        owner:users!resources_owner_id_fkey (
          id,
          name,
          email,
          trust_score
        )
      `)
      .single();

    if (error) throw error;
    createdResourceId = resource.id;

    // If listing_type is 'donate', auto-register in donations table
    if (listing_type === 'donate') {
      const { error: donError } = await supabase
        .from('donations')
        .insert({
          college_id: req.user.collegeId,
          donor_id: req.user.id,
          resource_id: resource.id,
          verified: false
        });

      if (donError) {
        throw donError;
      }
    }

    res.status(201).json({ resource });
  } catch (err) {
    console.error('create resource error', err);
    // Rollback any newly uploaded images if resource creation failed
    if (newUploads.length > 0) {
      await Promise.allSettled(newUploads.map(u => deleteFromCloudinary(u.publicId, u.resourceType)));
    }
    // Rollback created resource if subsequent donation insertion failed
    if (createdResourceId) {
      await supabase.from('resources').delete().eq('id', createdResourceId).catch(() => {});
    }
    if (err.code === 'CLOUDINARY_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Image upload service is temporarily unavailable.' });
    }
    res.status(500).json({ error: 'Could not create resource' });
  }
});

// PATCH /resources/:id
// Update resource (Owner or Admin only)
// Supports updating details, status, or appending uploaded images
router.patch('/:id', requireAuth, uploadImagesMiddleware, async (req, res) => {
  const newUploads = [];
  try {
    const resourceId = req.params.id;

    // 1. Fetch resource and verify tenant isolation
    const { data: existing, error: findError } = await supabase
      .from('resources')
      .select('*')
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: 'Resource not found or does not belong to your college' });
    }

    // 2. Ownership check
    if (existing.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — you are not the owner of this resource' });
    }

    const { title, category, condition, listing_type, status, image_urls } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (category !== undefined) updates.category = category.trim();
    if (condition !== undefined) updates.condition = condition ? condition.trim() : null;
    if (listing_type !== undefined) {
      if (!['lend', 'donate'].includes(listing_type)) {
        return res.status(400).json({ error: 'listing_type must be either "lend" or "donate"' });
      }
      updates.listing_type = listing_type;
    }
    if (status !== undefined) {
      updates.status = status;
    }

    // Handle images
    let currentImages = existing.image_urls || [];
    if (image_urls !== undefined) {
      if (typeof image_urls === 'string') {
        try {
          currentImages = JSON.parse(image_urls);
        } catch (e) {
          if (image_urls.trim()) currentImages = [image_urls.trim()];
        }
      } else if (Array.isArray(image_urls)) {
        currentImages = image_urls;
      }
    }

    if (req.files && req.files.length > 0) {
      if (currentImages.length + req.files.length > 5) {
        return res.status(400).json({ error: 'Resource cannot have more than 5 images in total.' });
      }

      // Verify signatures of new files
      for (const file of req.files) {
        if (!isValidImageSignature(file.buffer)) {
          return res.status(400).json({
            error: `File "${file.originalname}" does not have valid image content.`
          });
        }
      }

      for (const file of req.files) {
        const uploaded = await uploadToCloudinary(file.buffer, 'campusone/resources', 'image');
        newUploads.push(uploaded);
        currentImages.push(uploaded.url);
      }
      updates.image_urls = currentImages;
    } else if (image_urls !== undefined) {
      updates.image_urls = currentImages;
    }

    const { data: updatedResource, error: updateError } = await supabase
      .from('resources')
      .update(updates)
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId)
      .select(`
        *,
        owner:users!resources_owner_id_fkey (
          id,
          name,
          email,
          trust_score
        )
      `)
      .single();

    if (updateError) throw updateError;

    res.json({ resource: updatedResource });
  } catch (err) {
    console.error('update resource error', err);
    // Rollback only newly uploaded assets, not existing ones
    if (newUploads.length > 0) {
      await Promise.allSettled(newUploads.map(u => deleteFromCloudinary(u.publicId, u.resourceType)));
    }
    if (err.code === 'CLOUDINARY_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Image upload service is temporarily unavailable.' });
    }
    res.status(500).json({ error: 'Could not update resource' });
  }
});

// DELETE /resources/:id
// Allowed role: Resource Owner OR Admin
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const resourceId = req.params.id;

    // 1. Fetch resource and verify tenant isolation
    const { data: resource, error: findError } = await supabase
      .from('resources')
      .select('id, owner_id, college_id, status')
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (findError || !resource) {
      return res.status(404).json({ error: 'Resource not found or does not belong to your college' });
    }

    // 2. Ownership check: Must be the resource owner OR admin
    if (resource.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — only the owner or an admin can delete this resource' });
    }

    // 3. Status check: Prevent deletion if actively borrowed
    if (['REQUESTED', 'APPROVED', 'ACTIVE'].includes(resource.status)) {
      return res.status(400).json({
        error: `Cannot delete resource while it is in '${resource.status}' status. Complete or reject any active requests first.`
      });
    }

    const { error: deleteError } = await supabase
      .from('resources')
      .delete()
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId);

    if (deleteError) throw deleteError;

    res.json({ success: true, message: 'Resource removed successfully' });
  } catch (err) {
    console.error('delete resource error', err);
    res.status(500).json({ error: 'Could not delete resource' });
  }
});

module.exports = router;
