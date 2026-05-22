require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');
const ImageKit = require('imagekit');

const Product = require('./src/models/Product');

const newImageKit = new ImageKit({
  publicKey: 'public_g5OP2doHZxgXhvVNWDn8SVPuWTk=',
  privateKey: 'private_rHAo0WNy/E4BYflmv+5IdmwKzBg=',
  urlEndpoint: 'https://ik.imagekit.io/i6sduidzi'
});

const downloadFolder = path.join(__dirname, 'downloaded-images');
const mappingFile = path.join(__dirname, 'image-mapping.json');

// Ensure directory exists
if (!fs.existsSync(downloadFolder)) {
  fs.mkdirSync(downloadFolder, { recursive: true });
}

// Load existing mapping if any to prevent duplicates/re-uploads
let mapping = {};
if (fs.existsSync(mappingFile)) {
  try {
    mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
  } catch (e) {
    console.log('Could not parse existing mapping file, starting fresh.');
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const downloadImage = async (url, filepath, retries = 3) => {
  if (fs.existsSync(filepath)) {
    return true; // Already downloaded
  }
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
             // handle redirect
             https.get(res.headers.location, handleResponse).on('error', reject);
             return;
          }
          function handleResponse(res2) {
             if (res2.statusCode !== 200) {
               reject(new Error(`Failed to download: ${res2.statusCode}`));
               return;
             }
             const stream = fs.createWriteStream(filepath);
             res2.pipe(stream);
             stream.on('finish', () => stream.close(resolve));
          }
          handleResponse(res);
        }).on('error', reject);
      });
      return true;
    } catch (err) {
      console.error(`Download failed for ${url}, attempt ${i + 1}/${retries}: ${err.message}`);
      if (i === retries - 1) throw err;
      await sleep(2000 * (i + 1));
    }
  }
};

const uploadImage = async (filepath, filename, retries = 3) => {
  if (mapping[filename]) {
    return mapping[filename]; // Already uploaded
  }
  for (let i = 0; i < retries; i++) {
    try {
      const response = await newImageKit.upload({
        file: fs.readFileSync(filepath),
        fileName: filename,
        folder: '/products'
      });
      mapping[filename] = response.url;
      // Save mapping on each success
      fs.writeFileSync(mappingFile, JSON.stringify(mapping, null, 2));
      return response.url;
    } catch (err) {
      console.error(`Upload failed for ${filename}, attempt ${i + 1}/${retries}: ${err.message}`);
      if (i === retries - 1) throw err;
      await sleep(2000 * (i + 1));
    }
  }
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const products = await Product.find({});
    console.log(`Found ${products.length} products`);

    let updatedCount = 0;

    for (const product of products) {
      if (!product.images || product.images.length === 0) continue;
      
      let changed = false;
      let newImages = [];

      console.log(`Processing product: ${product.name} (${product._id})`);

      for (const oldUrl of product.images) {
        // Only process if it's an imagekit URL
        if (!oldUrl.includes('ik.imagekit.io')) {
          newImages.push(oldUrl);
          continue;
        }

        // If it already contains the new endpoint, skip migration
        if (oldUrl.includes('ik.imagekit.io/i6sduidzi')) {
          newImages.push(oldUrl);
          continue;
        }

        const filename = decodeURIComponent(path.basename(oldUrl.split('?')[0]));
        // Avoid weird characters in file path
        const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const filepath = path.join(downloadFolder, safeFilename);

        try {
          // 1. Download
          await downloadImage(oldUrl, filepath);

          // 2. Upload
          const newUrl = await uploadImage(filepath, filename);

          // 3. Update URL list
          if (newUrl !== oldUrl) {
            newImages.push(newUrl);
            changed = true;
          } else {
            newImages.push(oldUrl);
          }
        } catch (err) {
          console.error(`  Error processing ${oldUrl}: ${err.message}`);
          newImages.push(oldUrl); // Keep old URL on failure to avoid data loss
        }
      }

      // 4. Update MongoDB document if changes occurred
      // We do deep comparison just in case
      if (changed && JSON.stringify(product.images) !== JSON.stringify(newImages)) {
        product.images = newImages;
        await product.save();
        updatedCount++;
        console.log(`  Updated MongoDB for product: ${product.name}`);
      }
    }

    console.log(`Migration complete! Updated ${updatedCount} products.`);
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
})();
