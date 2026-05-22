const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');
require('dotenv').config();

const Product = require('./src/models/Product');

mongoose.connect(process.env.MONGO_URI);

const download = (url, filepath) => {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const stream = fs.createWriteStream(filepath);
      res.pipe(stream);

      stream.on('finish', () => {
        stream.close(resolve);
      });
    }).on('error', reject);
  });
};

(async () => {
  const products = await Product.find();

  fs.mkdirSync('./downloaded-images', { recursive: true });

  for (const product of products) {
    if (!product.images) continue;

    for (const url of product.images) {
      const filename = path.basename(url.split('?')[0]);

      console.log('Downloading:', filename);

      await download(
        url,
        path.join('./downloaded-images', filename)
      );
    }
  }

  console.log('All images downloaded');
  process.exit();
})();
