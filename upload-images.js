const fs = require('fs');
const path = require('path');
const ImageKit = require('imagekit');

const imagekit = new ImageKit({
  publicKey: 'PASTE_PUBLIC_KEY_HERE',
  privateKey: 'PASTE_PRIVATE_KEY_HERE',
  urlEndpoint: 'https://ik.imagekit.io/YOUR_ENDPOINT'
});

const folder = './downloaded-images';

(async () => {
  try {
    const files = fs.readdirSync(folder);

    const mapping = {};

    for (const file of files) {
      const filepath = path.join(folder, file);

      console.log('Uploading:', file);

      const response = await imagekit.upload({
        file: fs.readFileSync(filepath),
        fileName: file,
        folder: '/products'
      });

      mapping[file] = response.url;

      console.log('Uploaded:', response.url);
    }

    fs.writeFileSync(
      'image-mapping.json',
      JSON.stringify(mapping, null, 2)
    );

    console.log('Done uploading all images');
  } catch (err) {
    console.error(err);
  }
})();
