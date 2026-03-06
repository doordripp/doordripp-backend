/**
 * Multer configuration for file uploads
 * Handles proof of delivery photos
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const uploadDir = path.join(__dirname, '../../public/uploads/delivery-proof');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration for proof of delivery
const proofOfDeliveryStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const orderId = req.params.id || 'unknown';
    cb(null, `order-${orderId}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// File filter - only images
const imageFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
};

// Multer upload middleware for proof of delivery
const uploadProofOfDelivery = multer({
  storage: proofOfDeliveryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  },
  fileFilter: imageFileFilter
});

module.exports = {
  uploadProofOfDelivery
};
