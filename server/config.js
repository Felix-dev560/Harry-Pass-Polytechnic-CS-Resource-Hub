'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

// Fail fast with a readable message instead of crashing later on the first request.
const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing environment variables: ${missing.join(', ')}. See .env.example.`);
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters.');
}

// Secret that lets someone create the first admin account or reset the admin password. Optional: without it,
// registration and password recovery are switched off (an existing admin can still sign in as usual).
const setupKey = process.env.ADMIN_SETUP_KEY || '';
if (setupKey && setupKey.length < 16) {
  throw new Error('ADMIN_SETUP_KEY must be at least 16 characters.');
}
if (!setupKey) {
  console.warn('ADMIN_SETUP_KEY is not set: creating an admin account and resetting the admin password are switched off.');
}

module.exports = {
  isProd: process.env.NODE_ENV === 'production',
  adminSetupKey: setupKey,
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET,
  // Web Push keys. Optional: without them the site works normally and notifications are simply switched off.
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },
  cloudinary: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  },
};