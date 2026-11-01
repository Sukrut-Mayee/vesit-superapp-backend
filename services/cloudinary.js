const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Uploads a file buffer (from multer memoryStorage) to Cloudinary.
 * Returns the secure URL and resource metadata.
 * @param {Buffer} fileBuffer
 * @param {string} folder - e.g. 'campusone/notes'
 * @returns {Promise<{url: string, resourceType: string, format: string}>}
 */
function uploadToCloudinary(fileBuffer, folder = 'campusone/notes') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto' // handles pdf, image, etc.
      },
      (error, result) => {
  if (error) {
    console.error('CLOUDINARY UPLOAD ERROR:', {
      message: error.message,
      http_code: error.http_code,
      name: error.name,
      response: error.response,
      fullError: error
    });
    return reject(error);
  }

  resolve({
          url: result.secure_url,
          resourceType: result.resource_type,
          format: result.format
        });
      }
    );
    stream.end(fileBuffer);
  });
}

module.exports = { uploadToCloudinary };
