const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const mongoose = require('mongoose');
const cron = require('node-cron');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// MongoDB Connection (Replace with your connection string)
mongoose.connect('mongodb://localhost:27017/selfdestruct_images', { useNewUrlParser: true, useUnifiedTopology: true });

// AWS S3 Configuration (Replace with your credentials)
const s3 = new AWS.S3({
  accessKeyId: 'YOUR_AWS_ACCESS_KEY_ID',
  secretAccessKey: 'YOUR_AWS_SECRET_ACCESS_KEY',
  region: 'YOUR_AWS_REGION'
});

// Multer Configuration for File Uploads
const storage = multer.memoryStorage(); // Store file in memory for processing
const upload = multer({ storage: storage });

// Image Schema
const imageSchema = new mongoose.Schema({
  originalFilename: String,
  uniqueFilename: String,
  s3Url: String,
  expiryTimestamp: Date,
  shortLink: String,
});

const Image = mongoose.model('Image', imageSchema);


app.use(express.json()); // For parsing JSON request bodies
app.use(express.urlencoded({ extended: true })); // For parsing URL-encoded request bodies

// Upload Endpoint
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const { expirySeconds } = req.body; // Expecting expiry time in seconds from the request
    const expiryTimeInSeconds = parseInt(expirySeconds, 10) || 60; // Default to 60 seconds if not provided or invalid

    const file = req.file;
    const uniqueFilename = uuidv4();
    const expiryTimestamp = new Date(Date.now() + expiryTimeInSeconds * 1000); // Calculate expiry time

    // S3 Upload parameters
    const params = {
      Bucket: 'YOUR_S3_BUCKET_NAME',
      Key: uniqueFilename,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',  // Adjust ACL as needed
    };

    // Upload to S3
    const s3UploadResult = await s3.upload(params).promise();
    const s3Url = s3UploadResult.Location;

    // Create Image Metadata
    const newImage = new Image({
      originalFilename: file.originalname,
      uniqueFilename: uniqueFilename,
      s3Url: s3Url,
      expiryTimestamp: expiryTimestamp,
    });

    await newImage.save();

    // Shorten the link using Bitly API
    const bitlyApiKey = 'YOUR_BITLY_API_KEY';  // Replace with your Bitly API key
    const bitlyEndpoint = 'https://api-ssl.bitly.com/v3/shorten';

    try {
      const bitlyResponse = await axios.get(bitlyEndpoint, {
        params: {
          access_token: bitlyApiKey,
          longUrl: s3Url,
          format: 'json',
        },
      });

      if (bitlyResponse.data.status_code === 200) {
        newImage.shortLink = bitlyResponse.data.data.url;
        await newImage.save();

        res.json({
          success: true,
          shortLink: newImage.shortLink,
        });
      } else {
        console.error('Bitly error:', bitlyResponse.data);
        res.status(500).json({ success: false, message: 'Error shortening link' });
      }
    } catch (error) {
      console.error('Bitly API error:', error);
      res.status(500).json({ success: false, message: 'Error shortening link' });
    }

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
});


// Image Retrieval Endpoint (with expiry check)
app.get('/image/:uniqueFilename', async (req, res) => {
  const { uniqueFilename } = req.params;

  try {
    const image = await Image.findOne({ uniqueFilename: uniqueFilename });

    if (!image) {
      return res.status(404).send('Image not found');
    }

    const now = new Date();
    if (now > image.expiryTimestamp) {
      // Image has expired - Delete it from S3 and the database
      try {
        // Delete from S3
        const params = {
          Bucket: 'YOUR_S3_BUCKET_NAME',
          Key: image.uniqueFilename,
        };

        await s3.deleteObject(params).promise();
        console.log(`Deleted ${image.uniqueFilename} from S3`);

        // Delete from MongoDB
        await Image.deleteOne({ _id: image._id });
        console.log(`Deleted ${image.uniqueFilename} from MongoDB`);

        return res.status(410).send('Image expired'); // 410 Gone status code
      } catch (s3DeletionError) {
        console.error('Error deleting from S3:', s3DeletionError);
        return res.status(500).send('Error deleting image');
      }
    } else {
      // Image is valid - Serve it (with headers to try and prevent saving)
      res.set('Content-Security-Policy', "default-src 'self'"); // Example CSP (adjust as needed)
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('X-Frame-Options', 'DENY');
      res.set('Cache-Control', 'no-store');
      res.set('Pragma', 'no-cache');

      // Consider using a Canvas-based approach to render the image here to make it slightly harder to download.

      //Redirect to S3 URL
      res.redirect(image.s3Url);

    }
  } catch (error) {
    console.error('Image retrieval error:', error);
    res.status(500).send('Error retrieving image');
  }
});


// Scheduled Task to Delete Expired Images (Using node-cron)
cron.schedule('*/1 * * * *', async () => {
  console.log('Running cron job to delete expired images');

  try {
    const now = new Date();
    const expiredImages = await Image.find({ expiryTimestamp: { $lt: now } });

    for (const image of expiredImages) {
      try {
        // Delete from S3
        const params = {
          Bucket: 'YOUR_S3_BUCKET_NAME',
          Key: image.uniqueFilename,
        };

        await s3.deleteObject(params).promise();
        console.log(`Deleted ${image.uniqueFilename} from S3`);

        // Delete from MongoDB
        await Image.deleteOne({ _id: image._id });
        console.log(`Deleted ${image.uniqueFilename} from MongoDB`);
      } catch (s3DeletionError) {
        console.error('Error deleting from S3:', s3DeletionError);
      }
    }
  } catch (error) {
    console.error('Error finding expired images:', error);
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
