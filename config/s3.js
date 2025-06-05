const AWS = require('aws-sdk');
require('dotenv').config();

const s3 = new AWS.S3({
  accessKeyId: process.env.CELLAR_ADDON_KEY_ID,
  secretAccessKey: process.env.CELLAR_ADDON_KEY_SECRET,
  endpoint: process.env.CELLAR_ADDON_HOST,
  s3ForcePathStyle: true // Necesario para S3-compatible como Cellar
});

const S3_BUCKET_NAME = process.env.CELLAR_BUCKET;

module.exports = { s3, S3_BUCKET_NAME }; 