console.log('🌐 Universal Scraper Test');
console.log('Environment variables:');
console.log('COLLECTION_URL:', process.env.COLLECTION_URL);
console.log('COLLECTION_NAME:', process.env.COLLECTION_NAME);
console.log('COLLECTION_DISPLAY_NAME:', process.env.COLLECTION_DISPLAY_NAME);

import dotenv from 'dotenv';
dotenv.config();

console.log('After dotenv:');
console.log('SENDER_EMAIL:', process.env.SENDER_EMAIL);
console.log('SENDER_PWD:', process.env.SENDER_PWD ? '[SET]' : '[NOT SET]');

console.log('✅ Universal scraper imports working');
