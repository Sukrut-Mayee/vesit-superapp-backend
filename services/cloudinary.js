const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif'
]);

const ALLOWED_IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif'
]);

/**
 * Checks whether required Cloudinary environment variables are set.
 * Does not log or expose any credential values.
 * @returns {boolean}
 */
function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Validates magic bytes / buffer header to verify authentic image content.
 * Supports JPEG, PNG, WebP, and GIF.
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isValidImageSignature(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
    return false;
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  // PNG: 89 50 4E 47 (\x89PNG)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return true;
  }
  // WebP: RIFF ... WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return true;
  }
  // GIF: GIF (47 49 46)
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return true;
  }
  return false;
}

/**
 * Uploads a file buffer (from multer memoryStorage) to Cloudinary.
 * Returns the secure URL, public ID, and resource metadata.
 * @param {Buffer} fileBuffer
 * @param {string} folder - e.g. 'campusone/lost-found' or 'campusone/resources'
 * @param {string} [resourceType='auto']
 * @returns {Promise<{url: string, publicId: string, resourceType: string, format: string}>}
 */
function uploadToCloudinary(fileBuffer, folder = 'campusone/notes', resourceType = 'auto') {
  return new Promise((resolve, reject) => {
    if (!isCloudinaryConfigured()) {
      const error = new Error('Cloudinary service is not configured on the server.');
      error.code = 'CLOUDINARY_NOT_CONFIGURED';
      console.error('[Cloudinary] Upload failed: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET is unset.');
      return reject(error);
    }

    if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
      const error = new Error('Invalid file buffer provided for upload.');
      error.code = 'INVALID_FILE_BUFFER';
      return reject(error);
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType
      },
      (error, result) => {
        if (error) {
          console.error(`[Cloudinary] Upload stream error for folder "${folder}":`, error.message || error);
          return reject(error);
        }
        if (!result || !result.secure_url) {
          const malformedErr = new Error('Cloudinary response did not contain secure_url.');
          malformedErr.code = 'MALFORMED_CLOUDINARY_RESPONSE';
          return reject(malformedErr);
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          resourceType: result.resource_type,
          format: result.format
        });
      }
    );

    stream.on('error', (streamErr) => {
      console.error('[Cloudinary] Upload stream emitted error:', streamErr.message || streamErr);
      reject(streamErr);
    });

    stream.end(fileBuffer);
  });
}

/**
 * Deletes an uploaded asset from Cloudinary by public ID.
 * Used for rollback/cleanup if subsequent database operations fail.
 * @param {string} publicId
 * @param {string} [resourceType='image']
 * @returns {Promise<any>}
 */
function deleteFromCloudinary(publicId, resourceType = 'image') {
  if (!publicId) return Promise.resolve(null);
  if (!isCloudinaryConfigured()) return Promise.resolve(null);

  return new Promise((resolve) => {
    cloudinary.uploader.destroy(publicId, { resource_type: resourceType }, (error, result) => {
      if (error) {
        console.error(`[Cloudinary] Failed to delete asset "${publicId}":`, error.message || error);
        return resolve(null); // Resolve to avoid masking the primary database error
      }
      resolve(result);
    });
  });
}

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  isCloudinaryConfigured,
  isValidImageSignature,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_IMAGE_EXTS
};
