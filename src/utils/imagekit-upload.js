const ImageKit = require('imagekit');
const axios = require('axios');
const logger = require('./logger');

let imagekit = null;

const getImageKitConfig = () => ({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || process.env.IMAGEKIT_ID || '',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || process.env.IMAGEKIT_API_SECRET || '',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || process.env.IMAGEKIT_URL || ''
});

const hasImageKitConfig = () => {
  const config = getImageKitConfig();
  return Boolean(config.publicKey && config.privateKey && config.urlEndpoint);
};

const getImageKitInstance = () => {
  if (imagekit) {
    return imagekit;
  }

  if (!hasImageKitConfig()) {
    return null;
  }

  const config = getImageKitConfig();
  imagekit = new ImageKit(config);
  return imagekit;
};

if (!hasImageKitConfig()) {
  logger.warn('ImageKit credentials not configured - photo uploads will use fallback URLs');
}

/**
 * Upload image to ImageKit from URL (e.g., Google profile photo)
 * @param {string} imageUrl - The URL of the image to upload
 * @param {string} fileName - The desired file name
 * @param {string} folder - The folder path in ImageKit (e.g., 'avatars')
 * @returns {Promise<Object>} - ImageKit upload response with url, fileId, etc.
 */
async function uploadFromUrl(imageUrl, fileName, folder = 'avatars') {
  try {
    const currentImageKit = getImageKitInstance();

    if (!currentImageKit) {
      logger.warn('ImageKit not initialized; using original image URL');
      return { url: imageUrl, source: 'external' }; // Return original URL as fallback
    }

    // Download the image as a buffer
    const response = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      timeout: 10000 // 10 second timeout
    });
    const buffer = Buffer.from(response.data, 'binary');

    // Upload to ImageKit
    const result = await currentImageKit.upload({
      file: buffer,
      fileName: fileName,
      folder: folder,
      useUniqueFileName: true,
      transformation: {
        pre: 'l-image,i-logo.png,lx-N10,ly-N10,w-100,h-100' // Optional: add watermark/transformations
      }
    });

    return {
      url: result.url,
      fileId: result.fileId,
      filePath: result.filePath,
      source: 'imagekit'
    };
  } catch (error) {
    logger.error('ImageKit upload error:', error);
    // Return original URL as fallback if upload fails
    return { url: imageUrl, source: 'external', error: error.message };
  }
}

/**
 * Upload image to ImageKit from base64 data
 * @param {string} base64Data - Base64 encoded image data
 * @param {string} fileName - The desired file name
 * @param {string} folder - The folder path in ImageKit
 * @returns {Promise<Object>} - ImageKit upload response
 */
async function uploadFromBase64(base64Data, fileName, folder = 'avatars') {
  try {
    const currentImageKit = getImageKitInstance();

    if (!currentImageKit) {
      throw new Error('ImageKit not initialized - credentials may be missing');
    }

    const result = await currentImageKit.upload({
      file: base64Data,
      fileName: fileName,
      folder: folder,
      useUniqueFileName: true
    });

    return {
      url: result.url,
      fileId: result.fileId,
      filePath: result.filePath,
      source: 'imagekit'
    };
  } catch (error) {
    logger.error('ImageKit upload from base64 error:', error);
    throw error;
  }
}

/**
 * Delete file from ImageKit
 * @param {string} fileId - The ImageKit file ID
 */
async function deleteFile(fileId) {
  try {
    const currentImageKit = getImageKitInstance();

    if (!fileId || !currentImageKit) return;
    await currentImageKit.deleteFile(fileId);
    logger.info(`Deleted ImageKit file: ${fileId}`);
  } catch (error) {
    logger.error('ImageKit delete error:', error);
  }
}

module.exports = {
  uploadFromUrl,
  uploadFromBase64,
  deleteFile,
  getImageKitInstance
};
