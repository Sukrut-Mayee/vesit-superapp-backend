const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { Writable } = require('node:stream');

// Mock MulterError for unit testing without node_modules dependency
class MulterError extends Error {
  constructor(code, field) {
    super(code);
    this.name = 'MulterError';
    this.code = code;
    this.field = field;
  }
}

let mockCloudinaryStreamResult = {
  secure_url: 'https://res.cloudinary.com/demo/image/upload/campusone/test-123.jpg',
  public_id: 'campusone/test-123',
  resource_type: 'image',
  format: 'jpg'
};
let mockCloudinaryStreamError = null;
let uploadCount = 0;
let failOnUploadIndex = -1; // -1 means don't fail, 1 means fail on 2nd upload, etc.

let lastDestroyedPublicId = null;
let lastDestroyedResourceType = null;
let allDestroyedAssets = [];
let mockDestroyError = null;

const mockCloudinarySDK = {
  v2: {
    config: () => {},
    uploader: {
      upload_stream: (options, cb) => {
        const stream = new Writable({
          write(chunk, encoding, callback) {
            callback();
          }
        });
        stream.on('finish', () => {
          if (mockCloudinaryStreamError) {
            return cb(mockCloudinaryStreamError);
          }
          if (failOnUploadIndex !== -1 && uploadCount === failOnUploadIndex) {
            uploadCount++;
            return cb(new Error('Cloudinary socket connection dropped'));
          }
          uploadCount++;
          const generatedId = `campusone/test-${uploadCount}`;
          cb(null, {
            ...mockCloudinaryStreamResult,
            public_id: generatedId,
            secure_url: `https://res.cloudinary.com/demo/image/upload/${generatedId}.jpg`
          });
        });
        return stream;
      },
      destroy: (publicId, options, cb) => {
        lastDestroyedPublicId = publicId;
        lastDestroyedResourceType = options ? options.resource_type : undefined;
        allDestroyedAssets.push({ publicId, resourceType: lastDestroyedResourceType });
        if (mockDestroyError) {
          return cb(mockDestroyError);
        }
        cb(null, { result: 'ok' });
      }
    }
  }
};

let multerSimulatedError = null;
const mockMulter = Object.assign(
  (config) => ({
    single: (fieldname) => (req, res, next) => {
      if (multerSimulatedError) return next(multerSimulatedError);
      next();
    },
    array: (fieldname, maxCount) => (req, res, next) => {
      if (multerSimulatedError) return next(multerSimulatedError);
      next();
    }
  }),
  {
    memoryStorage: () => ({}),
    MulterError
  }
);

let dbInsertRow = null;
let dbInsertError = null;
let dbDonationInsertError = null;
let dbDeletedRows = [];
let mockExistingResource = {
  id: 'res-1',
  owner_id: 'user-1',
  college_id: 'college-vesit',
  image_urls: ['https://res.cloudinary.com/demo/image/upload/existing-1.jpg'],
  status: 'AVAILABLE'
};

const mockSupabase = {
  from: (table) => ({
    insert: (row) => {
      if (table === 'donations') {
        if (dbDonationInsertError) {
          return Promise.resolve({ data: null, error: dbDonationInsertError });
        }
        return Promise.resolve({ data: { id: 'don-1', ...row }, error: null });
      }
      dbInsertRow = row;
      return {
        select: () => ({
          single: async () => {
            if (dbInsertError) throw dbInsertError;
            return { data: { id: 'mock-id-1', ...row }, error: null };
          }
        })
      };
    },
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({
          single: async () => ({
            data: mockExistingResource,
            error: null
          })
        }),
        single: async () => ({
          data: mockExistingResource,
          error: null
        })
      })
    }),
    update: (updates) => ({
      eq: () => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              if (dbInsertError) throw dbInsertError;
              return { data: { ...mockExistingResource, ...updates }, error: null };
            }
          })
        })
      })
    }),
    delete: () => ({
      eq: (field, val) => {
        dbDeletedRows.push({ table, field, val });
        return Promise.resolve({ error: null });
      }
    })
  })
};

const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'cloudinary') return mockCloudinarySDK;
  if (name === 'multer') return mockMulter;
  if (name === '../services/supabase' || name === './services/supabase') return mockSupabase;
  if (name === '../middleware/auth') return { requireAuth: (req, res, next) => next(), requireRole: () => (req, res, next) => next() };
  return originalLoad.call(this, name, ...args);
};

// Now safe to require services/cloudinary
const {
  isValidImageSignature,
  isCloudinaryConfigured,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_IMAGE_EXTS,
  uploadToCloudinary,
  deleteFromCloudinary
} = require('../services/cloudinary');

// Authentic image magic buffers
const VALID_JPEG_BUFFER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01
]);
const VALID_PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48
]);
const VALID_WEBP_BUFFER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50
]);
const VALID_GIF_BUFFER = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00
]);
const INVALID_EXE_BUFFER = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff
]);
const INVALID_TEXT_BUFFER = Buffer.from('Plain text content that is definitely not an image.');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
}

// ---------------------------------------------------------------------------
// 1. Buffer & Content Validation Tests
// ---------------------------------------------------------------------------
test('Image signature validation (magic bytes verification)', async (t) => {
  await t.test('accepts valid JPEG buffer', () => {
    assert.equal(isValidImageSignature(VALID_JPEG_BUFFER), true);
  });

  await t.test('accepts valid PNG buffer', () => {
    assert.equal(isValidImageSignature(VALID_PNG_BUFFER), true);
  });

  await t.test('accepts valid WebP buffer', () => {
    assert.equal(isValidImageSignature(VALID_WEBP_BUFFER), true);
  });

  await t.test('accepts valid GIF buffer', () => {
    assert.equal(isValidImageSignature(VALID_GIF_BUFFER), true);
  });

  await t.test('rejects Windows PE executable buffer (MZ header)', () => {
    assert.equal(isValidImageSignature(INVALID_EXE_BUFFER), false);
  });

  await t.test('rejects plain text buffer', () => {
    assert.equal(isValidImageSignature(INVALID_TEXT_BUFFER), false);
  });

  await t.test('rejects empty, null, or short buffers', () => {
    assert.equal(isValidImageSignature(null), false);
    assert.equal(isValidImageSignature(undefined), false);
    assert.equal(isValidImageSignature(Buffer.from([])), false);
    assert.equal(isValidImageSignature(Buffer.from([0xff, 0xd8])), false);
  });

  await t.test('allowed MIME types and extensions set contains standard formats', () => {
    assert.ok(ALLOWED_IMAGE_MIMES.has('image/jpeg'));
    assert.ok(ALLOWED_IMAGE_MIMES.has('image/png'));
    assert.ok(ALLOWED_IMAGE_MIMES.has('image/webp'));
    assert.ok(ALLOWED_IMAGE_MIMES.has('image/gif'));
    assert.ok(!ALLOWED_IMAGE_MIMES.has('application/pdf'));
    assert.ok(!ALLOWED_IMAGE_MIMES.has('application/x-msdownload'));

    assert.ok(ALLOWED_IMAGE_EXTS.has('.jpg'));
    assert.ok(ALLOWED_IMAGE_EXTS.has('.png'));
    assert.ok(ALLOWED_IMAGE_EXTS.has('.webp'));
    assert.ok(!ALLOWED_IMAGE_EXTS.has('.exe'));
  });

  await t.test('isCloudinaryConfigured returns boolean without throwing', () => {
    const configured = isCloudinaryConfigured();
    assert.equal(typeof configured, 'boolean');
  });

  await t.test('deleteFromCloudinary resolves safely on null or empty publicId', async () => {
    const result = await deleteFromCloudinary(null);
    assert.equal(result, null);
  });

  await t.test('deleteFromCloudinary passes resource_type to cloudinary.uploader.destroy', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'mock_cloud';
    process.env.CLOUDINARY_API_KEY = 'mock_key';
    process.env.CLOUDINARY_API_SECRET = 'mock_secret';
    lastDestroyedPublicId = null;
    lastDestroyedResourceType = null;

    await deleteFromCloudinary('campusone/item-456', 'image');
    assert.equal(lastDestroyedPublicId, 'campusone/item-456');
    assert.equal(lastDestroyedResourceType, 'image');
  });

  await t.test('deleteFromCloudinary failure does not reject or throw', async () => {
    mockDestroyError = new Error('Cloudinary API unreachable');
    try {
      const res = await deleteFromCloudinary('campusone/item-789', 'image');
      assert.equal(res, null); // Resolves null safely without bubbling exception
    } finally {
      mockDestroyError = null;
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Lost & Found Route Handler Tests (with Mock DB & Mock Cloudinary)
// ---------------------------------------------------------------------------
test('Lost & Found Upload Workflow & Error Handling', async (t) => {
  const lfRoutes = [];
  const mockRouter = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method =>
    [method, (path, ...handlers) => lfRoutes.push({ method, path, handlers, handler: handlers.at(-1), middleware: handlers })]));

  const prevLoad = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'express') return { Router: () => mockRouter };
    return prevLoad.call(this, name, ...args);
  };

  delete require.cache[require.resolve('../routes/lost-found')];
  try {
    require('../routes/lost-found');
  } finally {
    Module._load = prevLoad;
  }

  const postRoute = lfRoutes.find(r => r.method === 'post' && r.path === '/');
  assert.ok(postRoute, 'POST /lost-found route must be registered');
  const postHandler = postRoute.handler;

  await t.test('1. Valid image upload creates listing with photo_url', async () => {
    dbInsertError = null; lastDestroyedPublicId = null;
    process.env.CLOUDINARY_CLOUD_NAME = 'mock_cloud';
    process.env.CLOUDINARY_API_KEY = 'mock_key';
    process.env.CLOUDINARY_API_SECRET = 'mock_secret';

    const req = {
      body: { type: 'lost', description: 'Lost keys near lab 302' },
      file: { buffer: VALID_JPEG_BUFFER, originalname: 'keys.jpg', mimetype: 'image/jpeg' },
      user: { id: 'user-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.ok(res.body.listing);
    assert.ok(res.body.listing.photo_url.includes('res.cloudinary.com'));
    assert.equal(dbInsertRow.type, 'lost');
    assert.equal(dbInsertRow.description, 'Lost keys near lab 302');
    assert.equal(lastDestroyedPublicId, null, 'No assets should be destroyed on success');
  });

  await t.test('2. Text-only submission without file creates listing with photo_url: null', async () => {
    dbInsertError = null;
    const req = {
      body: { type: 'found', description: 'Found black umbrella in cafeteria' },
      file: undefined,
      user: { id: 'user-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.ok(res.body.listing);
    assert.equal(res.body.listing.photo_url, null);
  });

  await t.test('3. Rejects missing description or missing type with 400', async () => {
    const res1 = createResponse();
    await postHandler({ body: { type: 'lost', description: '   ' }, user: { id: 'u1', collegeId: 'c1' } }, res1);
    assert.equal(res1.statusCode, 400);

    const res2 = createResponse();
    await postHandler({ body: { type: 'invalid_type', description: 'some description' }, user: { id: 'u1', collegeId: 'c1' } }, res2);
    assert.equal(res2.statusCode, 400);
  });

  await t.test('4. Rejects file with invalid image signature (e.g. executable disguise)', async () => {
    const req = {
      body: { type: 'lost', description: 'Lost flash drive' },
      file: { buffer: INVALID_EXE_BUFFER, originalname: 'malicious.jpg', mimetype: 'image/jpeg' },
      user: { id: 'user-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('signature') || res.body.error.includes('Invalid'));
  });

  await t.test('5. Database failure triggers Cloudinary rollback of newly uploaded asset', async () => {
    dbInsertError = new Error('Database connection lost');
    lastDestroyedPublicId = null;

    const req = {
      body: { type: 'lost', description: 'Lost silver watch' },
      file: { buffer: VALID_PNG_BUFFER, originalname: 'watch.png', mimetype: 'image/png' },
      user: { id: 'user-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 500);
    assert.ok(lastDestroyedPublicId !== null, 'Uploaded asset must be cleaned up via deleteFromCloudinary on DB failure');
  });

  await t.test('6. Missing Cloudinary config returns 503 without unhandled crash', async () => {
    const oldName = process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    try {
      const req = {
        body: { type: 'lost', description: 'Lost blue scarf' },
        file: { buffer: VALID_JPEG_BUFFER, originalname: 'scarf.jpg', mimetype: 'image/jpeg' },
        user: { id: 'user-1', collegeId: 'college-vesit' }
      };
      const res = createResponse();
      await postHandler(req, res);

      assert.equal(res.statusCode, 503);
      assert.ok(res.body.error.includes('temporarily unavailable'));
    } finally {
      process.env.CLOUDINARY_CLOUD_NAME = oldName;
    }
  });

  await t.test('7. Multer LIMIT_FILE_SIZE returns 413 and LIMIT_UNEXPECTED_FILE returns 400', async () => {
    const uploadPhotoMw = postRoute.middleware.find(m => m.name === 'uploadPhotoMiddleware');
    assert.ok(uploadPhotoMw, 'uploadPhotoMiddleware must be in the middleware stack');

    // Test LIMIT_FILE_SIZE
    multerSimulatedError = new MulterError('LIMIT_FILE_SIZE', 'photo');
    const res1 = createResponse();
    uploadPhotoMw({ body: {} }, res1, () => {});
    assert.equal(res1.statusCode, 413);

    // Test LIMIT_UNEXPECTED_FILE
    multerSimulatedError = new MulterError('LIMIT_UNEXPECTED_FILE', 'unexpected_image');
    const res2 = createResponse();
    uploadPhotoMw({ body: {} }, res2, () => {});
    assert.equal(res2.statusCode, 400);

    multerSimulatedError = null;
  });
});

// ---------------------------------------------------------------------------
// 3. Resources Route Handler Tests (with Mock DB & Mock Cloudinary)
// ---------------------------------------------------------------------------
test('Resources Multi-Image Upload Workflow & Rollback', async (t) => {
  const resRoutes = [];
  const mockRouter = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method =>
    [method, (path, ...handlers) => resRoutes.push({ method, path, handlers, handler: handlers.at(-1), middleware: handlers })]));

  const prevLoad = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'express') return { Router: () => mockRouter };
    return prevLoad.call(this, name, ...args);
  };

  delete require.cache[require.resolve('../routes/resources')];
  try {
    require('../routes/resources');
  } finally {
    Module._load = prevLoad;
  }

  const postRoute = resRoutes.find(r => r.method === 'post' && r.path === '/');
  assert.ok(postRoute, 'POST /resources route must be registered');
  const postHandler = postRoute.handler;

  const patchRoute = resRoutes.find(r => r.method === 'patch' && r.path === '/:id');
  assert.ok(patchRoute, 'PATCH /resources/:id route must be registered');
  const patchHandler = patchRoute.handler;

  await t.test('1. Valid single image upload creates resource with image_urls', async () => {
    dbInsertError = null; lastDestroyedPublicId = null; uploadCount = 0; failOnUploadIndex = -1;
    const req = {
      body: { title: 'Casio Calculator', category: 'Hardware', condition: 'Like New', listing_type: 'lend' },
      files: [{ buffer: VALID_JPEG_BUFFER, originalname: 'calc.jpg', mimetype: 'image/jpeg' }],
      user: { id: 'student-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.ok(res.body.resource);
    assert.equal(res.body.resource.image_urls.length, 1);
  });

  await t.test('2. Valid multiple image upload (up to 5) succeeds', async () => {
    dbInsertError = null; uploadCount = 0; failOnUploadIndex = -1;
    const req = {
      body: { title: 'Arduino Uno Kit', category: 'Electronics', condition: 'Good', listing_type: 'lend' },
      files: [
        { buffer: VALID_PNG_BUFFER, originalname: 'ard1.png', mimetype: 'image/png' },
        { buffer: VALID_JPEG_BUFFER, originalname: 'ard2.jpg', mimetype: 'image/jpeg' }
      ],
      user: { id: 'student-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.resource.image_urls.length, 2);
  });

  await t.test('3. Pure JSON request with existing image_urls works without files', async () => {
    dbInsertError = null;
    const req = {
      body: {
        title: 'Laboratory Coat',
        category: 'Uniform',
        listing_type: 'donate',
        image_urls: ['https://res.cloudinary.com/demo/image/upload/coat.jpg']
      },
      files: undefined,
      user: { id: 'student-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body.resource.image_urls, ['https://res.cloudinary.com/demo/image/upload/coat.jpg']);
  });

  await t.test('4. Rejects upload if any file has invalid image signature', async () => {
    const req = {
      body: { title: 'Chemistry Textbook', category: 'Books', listing_type: 'lend' },
      files: [
        { buffer: VALID_PNG_BUFFER, originalname: 'front.png', mimetype: 'image/png' },
        { buffer: INVALID_EXE_BUFFER, originalname: 'back.jpg', mimetype: 'image/jpeg' }
      ],
      user: { id: 'student-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('does not have valid image content'));
  });

  await t.test('5. Rejects request with missing required fields (title, category, listing_type)', async () => {
    const res = createResponse();
    await postHandler({ body: { title: 'Only Title' }, user: { id: 'u1', collegeId: 'c1' } }, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test('6. Rejects invalid listing_type (must be lend or donate)', async () => {
    const res = createResponse();
    await postHandler({
      body: { title: 'Title', category: 'Books', listing_type: 'rent' },
      user: { id: 'u1', collegeId: 'c1' }
    }, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test('7. Database failure on resources insert triggers rollback of all newly uploaded images', async () => {
    dbInsertError = new Error('Database write error');
    allDestroyedAssets = [];
    uploadCount = 0; failOnUploadIndex = -1;

    const req = {
      body: { title: 'Digital Multimeter', category: 'Hardware', listing_type: 'lend' },
      files: [
        { buffer: VALID_JPEG_BUFFER, originalname: 'meter1.jpg', mimetype: 'image/jpeg' },
        { buffer: VALID_PNG_BUFFER, originalname: 'meter2.png', mimetype: 'image/png' }
      ],
      user: { id: 'student-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 500);
    assert.equal(allDestroyedAssets.length, 2, 'All 2 uploaded images must be rolled back');
    assert.equal(allDestroyedAssets[0].resourceType, 'image');
    assert.equal(allDestroyedAssets[1].resourceType, 'image');
  });

  await t.test('8. Middle Cloudinary upload failure cleans up earlier uploaded images', async () => {
    dbInsertError = null;
    allDestroyedAssets = [];
    uploadCount = 0;
    failOnUploadIndex = 1; // 1st upload succeeds (0), 2nd fails (1)

    const req = {
      body: { title: 'Oscilloscope Probe', category: 'Hardware', listing_type: 'lend' },
      files: [
        { buffer: VALID_JPEG_BUFFER, originalname: 'probe1.jpg', mimetype: 'image/jpeg' },
        { buffer: VALID_PNG_BUFFER, originalname: 'probe2.png', mimetype: 'image/png' },
        { buffer: VALID_WEBP_BUFFER, originalname: 'probe3.webp', mimetype: 'image/webp' }
      ],
      user: { id: 'student-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 500);
    assert.equal(allDestroyedAssets.length, 1, '1st image must be rolled back after 2nd fails');
    failOnUploadIndex = -1;
  });

  await t.test('9. Donation insert failure rolls back both the Supabase resource and Cloudinary assets', async () => {
    dbInsertError = null;
    dbDonationInsertError = new Error('Donations table constraint failure');
    dbDeletedRows = [];
    allDestroyedAssets = [];
    uploadCount = 0; failOnUploadIndex = -1;

    const req = {
      body: { title: 'Donation Book', category: 'Books', listing_type: 'donate' },
      files: [
        { buffer: VALID_PNG_BUFFER, originalname: 'book.png', mimetype: 'image/png' }
      ],
      user: { id: 'student-1', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await postHandler(req, res);

    assert.equal(res.statusCode, 500);
    assert.ok(dbDeletedRows.some(d => d.table === 'resources'), 'Orphaned resource must be deleted from Supabase');
    assert.equal(allDestroyedAssets.length, 1, 'Cloudinary asset must be rolled back');
    dbDonationInsertError = null;
  });

  await t.test('10. PATCH resource updates details and preserves existing image_urls', async () => {
    dbInsertError = null;
    const req = {
      params: { id: 'res-1' },
      body: { title: 'Casio Calculator (Updated)', condition: 'Used' },
      user: { id: 'user-1', role: 'student', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await patchHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.resource.title, 'Casio Calculator (Updated)');
    assert.deepEqual(res.body.resource.image_urls, ['https://res.cloudinary.com/demo/image/upload/existing-1.jpg']);
  });

  await t.test('11. PATCH appending new images preserves existing images and checks 5-image total limit', async () => {
    dbInsertError = null;
    uploadCount = 0; failOnUploadIndex = -1;
    const req = {
      params: { id: 'res-1' },
      body: {},
      files: [{ buffer: VALID_PNG_BUFFER, originalname: 'new_side.png', mimetype: 'image/png' }],
      user: { id: 'user-1', role: 'student', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await patchHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.resource.image_urls.length, 2);
    assert.equal(res.body.resource.image_urls[0], 'https://res.cloudinary.com/demo/image/upload/existing-1.jpg');
  });

  await t.test('12. PATCH rollback on DB failure deletes ONLY new uploads, leaving existing images intact', async () => {
    dbInsertError = new Error('Database connection failed during update');
    allDestroyedAssets = [];
    uploadCount = 0; failOnUploadIndex = -1;

    const req = {
      params: { id: 'res-1' },
      body: {},
      files: [{ buffer: VALID_JPEG_BUFFER, originalname: 'failing_patch.jpg', mimetype: 'image/jpeg' }],
      user: { id: 'user-1', role: 'student', collegeId: 'college-vesit' }
    };
    const res = createResponse();
    await patchHandler(req, res);

    assert.equal(res.statusCode, 500);
    assert.equal(allDestroyedAssets.length, 1);
    assert.ok(allDestroyedAssets[0].publicId.startsWith('campusone/test-'), 'Only newly uploaded asset is deleted');
    assert.ok(!allDestroyedAssets.some(a => a.publicId.includes('existing-1')), 'Existing images must NEVER be deleted');
    dbInsertError = null;
  });

  await t.test('13. Multer LIMIT_FILE_SIZE returns 413 and LIMIT_UNEXPECTED_FILE returns 400 for Resources', async () => {
    const uploadImagesMw = postRoute.middleware.find(m => m.name === 'uploadImagesMiddleware');
    assert.ok(uploadImagesMw, 'uploadImagesMiddleware must be in the middleware stack');

    // Test LIMIT_FILE_SIZE
    multerSimulatedError = new MulterError('LIMIT_FILE_SIZE', 'images');
    const res1 = createResponse();
    uploadImagesMw({ body: {} }, res1, () => {});
    assert.equal(res1.statusCode, 413);

    // Test LIMIT_UNEXPECTED_FILE
    multerSimulatedError = new MulterError('LIMIT_UNEXPECTED_FILE', 'random_field');
    const res2 = createResponse();
    uploadImagesMw({ body: {} }, res2, () => {});
    assert.equal(res2.statusCode, 400);

    multerSimulatedError = null;
  });
});
