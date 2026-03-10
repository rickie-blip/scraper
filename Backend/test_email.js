#!/usr/bin/env node
/**
 * Simple test to verify email functionality
 */

import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testEmail() {
    console.log('🧪 Testing email functionality...\n');
    
    // Check environment variables
    const senderEmail = process.env.SENDER_EMAIL;
    const senderPwd = process.env.SENDER_PWD;
    
    if (!senderEmail || !senderPwd) {
        console.error('❌ Missing email credentials!');
        console.log('Please set environment variables:');
        console.log('export SENDER_EMAIL="your-email@gmail.com"');
        console.log('export SENDER_PWD="your-app-password"');
        process.exit(1);
    }
    
    console.log(`📧 Sender Email: ${senderEmail}`);
    console.log('🔑 Password: [SET]');
    
    try {
        // Create transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: senderEmail,
                pass: senderPwd
            }
        });
        
        // Verify connection
        console.log('\n🔌 Testing SMTP connection...');
        await transporter.verify();
        console.log('✅ SMTP connection successful!');
        
        // Create a test CSV content
        const testCsvContent = `Handle,Title,Image Src,Product URL,Price
test-product-1,"Test PUMA Shoe","https://images.puma.com/test.jpg","https://us.puma.com/test",99.99
test-product-2,"Another Test Shoe","https://images.puma.com/test2.jpg","https://us.puma.com/test2",129.99`;
        
        const testCsvPath = path.join(__dirname, 'test_email.csv');
        fs.writeFileSync(testCsvPath, testCsvContent);
        
        // Send test email
        console.log('\n📨 Sending test email...');
        const info = await transporter.sendMail({
            from: senderEmail,
            to: ['nigel@shopzetu.com', 'patrick@shopzetu.com'],
            subject: '🧪 PUMA Scraper Email Test',
            text: `This is a test email from the PUMA inventory scraper.

Email functionality is working correctly!

Test details:
- Sender: ${senderEmail}
- Recipients: nigel@shopzetu.com, patrick@shopzetu.com
- Attachment: test_email.csv (2 sample products)

If you receive this email, the scraper email functionality is ready to use.`,
            attachments: [{
                filename: 'test_puma_products.csv',
                path: testCsvPath
            }]
        });
        
        console.log('✅ Test email sent successfully!');
        console.log(`📧 Message ID: ${info.messageId}`);
        
        // Clean up test file
        fs.unlinkSync(testCsvPath);
        console.log('🧹 Cleaned up test files');
        
        console.log('\n🎉 Email functionality test completed successfully!');
        console.log('You can now run the full scraper with confidence.');
        
    } catch (error) {
        console.error('❌ Email test failed:', error.message);
        
        if (error.code === 'EAUTH') {
            console.log('\n💡 Authentication failed. Please check:');
            console.log('1. Make sure you\'re using an App Password, not your regular password');
            console.log('2. Enable 2-Step Verification in your Google Account');
            console.log('3. Generate an App Password from Google Account settings');
        }
        
        process.exit(1);
    }
}

testEmail();
