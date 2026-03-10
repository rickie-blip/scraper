import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
import { writeToPath } from '@fast-csv/format';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

// Configuration
const CONFIG = {
  // Collection configuration - change this to scrape different sections
  collection: {
    name: process.env.COLLECTION_NAME || 'men-shoes', // Can be changed via environment variable
    url: process.env.COLLECTION_URL || 'https://us.puma.com/us/en/men/shoes',
    displayName: process.env.COLLECTION_DISPLAY_NAME || 'Men\'s Shoes'
  },
  
  // Email configuration
  email: {
    recipients: ['nigel@shopzetu.com'],
    sender: process.env.SENDER_EMAIL,
    password: process.env.SENDER_PWD,
    subject: `PUMA ${process.env.COLLECTION_DISPLAY_NAME || 'Men\'s Shoes'} Inventory Extract - ${new Date().toLocaleDateString()}`
  }
};

async function extractAllPumaShoes() {
  let browser;
  try {
    console.log('🚀 Starting comprehensive PUMA Products extraction...');
    
    browser = await puppeteer.launch({
      headless: true, // Run headless for efficiency
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const allProducts = new Set(); // Use Set to avoid duplicates
    let totalExtracted = 0;
    
    // Navigate to the page
    console.log(`🌐 Loading PUMA ${CONFIG.collection.displayName} page...`);
    await page.goto(CONFIG.collection.url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Function to extract products from current page state
    const extractCurrentPageProducts = async () => {
      return await page.evaluate(() => {
        const products = [];
        const productElements = document.querySelectorAll('[data-product-id]');
        
        productElements.forEach((element, index) => {
          try {
            // Extract product data
            const titleElement = element.querySelector('h1, h2, h3, h4, .title, .name, [data-testid*="title"], [data-testid*="name"], a[href*="/pd/"]');
            const priceElement = element.querySelector('.price, [data-testid*="price"], .cost, .amount, [class*="price"]');
            const imageElement = element.querySelector('img');
            const linkElement = element.querySelector('a[href*="/pd/"]') || element.querySelector('a');
            
            let title = '';
            let price = '';
            let image = '';
            let link = '';
            let productId = '';
            
            // Extract title
            if (titleElement) {
              title = titleElement.textContent?.trim() || titleElement.getAttribute('title') || '';
              // If it's a link, extract from href
              if (!title && titleElement.href) {
                const urlParts = titleElement.href.split('/');
                const pdIndex = urlParts.findIndex(part => part === 'pd');
                if (pdIndex >= 0 && urlParts[pdIndex + 1]) {
                  title = urlParts[pdIndex + 1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                }
              }
              
              // Clean up title by removing color count prefixes and other concatenated info
              if (title) {
                // Remove color count prefixes like "1 Color", "12 Colors", etc.
                title = title.replace(/^\d+\s+Colors?\s*/i, '');
                
                // More aggressive cleanup for PUMA's concatenated titles
                // First, try to find the product name before category/color information
                let cleanTitle = title;
                
                // Look for patterns that indicate where the product name ends
                const endPatterns = [
                  // Before category + subcategory (e.g., "Men's Basketball Shoes")
                  /(.*?)\s+(Men's|Women's|Kids'|Unisex)\s+(Basketball|Running|Training|Soccer|Lifestyle|Casual)\s+(Shoes|Sneakers|Cleats)/i,
                  // Before just category (e.g., "Men's Shoes") 
                  /(.*?)\s+(Men's|Women's|Kids'|Unisex)\s+(Shoes|Sneakers|Clothing|Hoodie|Tee|Jersey|Shorts|Pants)/i,
                  // Before color combinations (Team Light Blue-PUMA White)
                  /(.*?)\s+(Team\s+[A-Z][a-z]+|PUMA\s+[A-Z][a-z]+|[A-Z][a-z]+-[A-Z][a-z]+)/i,
                  // Before price
                  /(.*?)\s*\$\d+\.\d+/,
                  // Before status indicators
                  /(.*?)\s+(New|Best Seller|Sale|Exclusive)/i
                ];
                
                for (const pattern of endPatterns) {
                  const match = cleanTitle.match(pattern);
                  if (match && match[1] && match[1].trim().length >= 3) {
                    cleanTitle = match[1].trim();
                    break;
                  }
                }
                
                // If we still have a very long title, try word-by-word analysis
                if (cleanTitle.length > 60 || cleanTitle === title) {
                  const words = title.split(/\s+/);
                  let productName = '';
                  let foundEnd = false;
                  
                  for (let i = 0; i < words.length && !foundEnd; i++) {
                    const word = words[i];
                    const nextWord = words[i + 1];
                    
                    // Stop before category indicators
                    if (word.match(/^(Men's|Women's|Kids'|Unisex)$/i) && 
                        nextWord?.match(/^(Shoes|Sneakers|Basketball|Running|Clothing|Hoodie|Tee|Jersey)$/i)) {
                      foundEnd = true;
                      break;
                    }
                    
                    // Stop before color names (but keep brand names like PUMA)
                    if (word.match(/^(Team|Black|White|Blue|Red|Green|Yellow|Pink|Purple|Orange|Gray|Grey)$/i) && 
                        !word.match(/^(PUMA|Nike|Adidas)$/i)) {
                      foundEnd = true;
                      break;
                    }
                    
                    // Stop before price
                    if (word.includes('$')) {
                      foundEnd = true;
                      break;
                    }
                    
                    // Add word if we haven't found the end yet
                    if (!foundEnd) {
                      productName += (productName ? ' ' : '') + word;
                      
                      // Also stop if we have a reasonable length and next word looks like metadata
                      if (productName.length > 20 && nextWord?.match(/^(Team|PUMA|Men's|Women's|New|Best|\$)/i)) {
                        foundEnd = true;
                      }
                    }
                  }
                  
                  if (productName.length >= 3) {
                    cleanTitle = productName;
                  }
                }
                
                // Final cleanup
                title = cleanTitle
                  .replace(/\s+/g, ' ') // Normalize spaces
                  .trim();
                
                // Ensure we have a reasonable title
                if (title.length < 3) {
                  title = titleElement.textContent?.trim().substring(0, 50) || 'Unknown Product';
                }
              }
            }
            
            // Extract price
            if (priceElement) {
              price = priceElement.textContent?.trim() || '';
            }
            
            // Extract image
            if (imageElement) {
              image = imageElement.src || imageElement.getAttribute('data-src') || imageElement.getAttribute('data-lazy-src') || '';
            }
            
            // Extract link
            if (linkElement) {
              link = linkElement.href || '';
            }
            
            // Extract product ID from data attribute or link
            productId = element.getAttribute('data-product-id') || 
                       element.getAttribute('data-productid') ||
                       (link.match(/\/(\d+)/) && link.match(/\/(\d+)/)[1]) ||
                       `extracted-${index}`;
            
            // Only add if we have meaningful data
            if (title && title.length > 2 && !title.toLowerCase().includes('undefined')) {
              products.push({
                title: title,
                price: price,
                image: image,
                link: link,
                productId: productId,
                extractedAt: new Date().toISOString()
              });
            }
          } catch (e) {
            console.log(`Error extracting product ${index}:`, e.message);
          }
        });
        
        return products;
      });
    };

    // Extract initial products
    console.log('📦 Extracting initial products...');
    let products = await extractCurrentPageProducts();
    console.log(`Found ${products.length} products on initial load`);
    
    products.forEach(product => {
      const key = `${product.productId}-${product.title}`;
      allProducts.add(JSON.stringify(product));
    });
    
    totalExtracted = allProducts.size;

    // Scroll and load more products
    console.log('📜 Scrolling to load more products...');
    let previousCount = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 10;

    while (scrollAttempts < maxScrollAttempts) {
      // Scroll to bottom
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      // Wait for potential lazy loading
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract products again
      const newProducts = await extractCurrentPageProducts();
      const currentCount = newProducts.length;
      
      console.log(`Scroll ${scrollAttempts + 1}: Found ${currentCount} total products on page`);
      
      // Add new products to our set
      newProducts.forEach(product => {
        allProducts.add(JSON.stringify(product));
      });
      
      // Check if we found new products
      if (currentCount === previousCount) {
        console.log('No new products found, stopping scroll attempts');
        break;
      }
      
      previousCount = currentCount;
      scrollAttempts++;
    }

    // Look for "Load More" or pagination buttons
    console.log('🔍 Looking for Load More buttons...');
    try {
      const loadMoreSelectors = [
        'button[data-testid*="load-more"]',
        '.load-more',
        '[class*="load-more"]',
        'button:contains("Load More")',
        'button:contains("Show More")',
        '[data-testid="load-more-button"]'
      ];
      
      for (const selector of loadMoreSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            console.log(`Found Load More button with selector: ${selector}`);
            await button.click();
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const moreProducts = await extractCurrentPageProducts();
            console.log(`After clicking Load More: ${moreProducts.length} products found`);
            
            moreProducts.forEach(product => {
              allProducts.add(JSON.stringify(product));
            });
            break;
          }
        } catch (e) {
          // Continue trying other selectors
        }
      }
    } catch (e) {
      console.log('No Load More button found or error clicking it');
    }

    // Convert Set back to array and parse JSON
    const finalProducts = Array.from(allProducts).map(productStr => JSON.parse(productStr));
    
    console.log(`\n📊 Extraction Summary:`);
    console.log(`Total unique products found: ${finalProducts.length}`);
    
    if (finalProducts.length > 0) {
      console.log('Sample products:');
      finalProducts.slice(0, 3).forEach((product, index) => {
        console.log(`${index + 1}. ${product.title} - ${product.price || 'No price'}`);
      });
      
      // Format for Shopify CSV
      const shopifyProducts = finalProducts.map((product, index) => {
        const handle = product.title
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        return {
          Handle: handle,
          Title: product.title,
          'Image Src': product.image || '',
          'Product URL': product.link.startsWith('http') ? product.link : `https://us.puma.com${product.link}`,
          Price: product.price || '',
          'Product ID': product.productId,
          'Extraction Method': 'Comprehensive DOM Extraction',
          'Extracted At': product.extractedAt
        };
      });
      
      const filename = await saveToCSV(shopifyProducts);
      return { products: shopifyProducts, filename };
    }

    return { products: [], filename: null };

  } catch (error) {
    console.error('❌ Error during extraction:', error.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function saveToCSV(products) {
  if (products.length === 0) {
    console.log('No products to save');
    return null;
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `puma_${CONFIG.collection.name}_${timestamp}.csv`;
  
  try {
    await writeToPath(filename, products, { headers: true });
    console.log(`✅ Successfully saved ${products.length} products to ${filename}`);
    console.log(`📁 File ready for Shopify import!`);
    return filename;
  } catch (error) {
    console.error('Error saving CSV:', error.message);
    return null;
  }
}

async function sendEmailWithCSV(csvFilename) {
  if (!csvFilename || !CONFIG.email.sender || !CONFIG.email.password) {
    console.log('⚠️  Email not sent - missing CSV file, sender email, or password');
    if (!CONFIG.email.sender) console.log('   Set SENDER_EMAIL environment variable');
    if (!CONFIG.email.password) console.log('   Set SENDER_PWD environment variable');
    return false;
  }

  try {
    console.log('📧 Setting up email transporter...');
    
    // Create transporter (Gmail configuration)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: CONFIG.email.sender,
        pass: CONFIG.email.password
      }
    });

    // Verify connection
    await transporter.verify();
    console.log('✅ Email server connection verified');

    // Get file stats
    const stats = fs.statSync(csvFilename);
    const fileSizeKB = Math.round(stats.size / 1024);

    // Email content
    const emailHtml = `
      <h2>🎯 PUMA ${CONFIG.collection.displayName} Inventory Extract</h2>
      <p><strong>Extraction completed successfully!</strong></p>
      
      <h3>📊 Summary:</h3>
      <ul>
        <li><strong>Collection:</strong> ${CONFIG.collection.displayName}</li>
        <li><strong>Total Products:</strong> ${csvFilename.includes('_') ? 'See attachment' : 'Unknown'}</li>
        <li><strong>File Size:</strong> ${fileSizeKB} KB</li>
        <li><strong>Generated:</strong> ${new Date().toLocaleString()}</li>
        <li><strong>Format:</strong> Shopify-ready CSV</li>
      </ul>

      <h3>📋 CSV Columns:</h3>
      <ul>
        <li>Handle (URL-friendly identifier)</li>
        <li>Title (Product name)</li>
        <li>Image Src (Product image URL)</li>
        <li>Product URL (Link to original product)</li>
        <li>Price (Product pricing)</li>
        <li>Product ID (Unique identifier)</li>
        <li>Extraction Method</li>
        <li>Extracted At (Timestamp)</li>
      </ul>

      <h3>🚀 Next Steps:</h3>
      <ol>
        <li>Download the attached CSV file</li>
        <li>Review the product data</li>
        <li>Import to Shopify using the CSV import feature</li>
        <li>Configure product settings as needed</li>
      </ol>

      <p><em>This automated extract was generated by the PUMA Inventory Scraper.</em></p>
    `;

    const emailText = `
PUMA ${CONFIG.collection.displayName} Inventory Extract

Extraction completed successfully!

Summary:
- Collection: ${CONFIG.collection.displayName}
- File Size: ${fileSizeKB} KB
- Generated: ${new Date().toLocaleString()}
- Format: Shopify-ready CSV

The CSV file is attached and ready for Shopify import.

CSV includes: Handle, Title, Image Src, Product URL, Price, Product ID, Extraction Method, Extracted At
    `;

    // Send email
    console.log(`📤 Sending email to ${CONFIG.email.recipients.join(', ')}...`);
    
    const mailOptions = {
      from: CONFIG.email.sender,
      to: CONFIG.email.recipients.join(', '),
      subject: CONFIG.email.subject,
      text: emailText,
      html: emailHtml,
      attachments: [
        {
          filename: csvFilename,
          path: path.resolve(csvFilename),
          contentType: 'text/csv'
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully!');
    console.log(`📧 Message ID: ${info.messageId}`);
    console.log(`📬 Recipients: ${CONFIG.email.recipients.join(', ')}`);
    
    return true;

  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
    
    if (error.message.includes('Invalid login')) {
      console.log('💡 Email troubleshooting:');
      console.log('   1. Make sure SENDER_EMAIL and SENDER_PWD are correct');
      console.log('   2. Enable "App Passwords" in Gmail settings');
      console.log('   3. Use the App Password instead of your regular password');
      console.log('   4. Enable "Less secure app access" if using regular password');
    }
    
    return false;
  }
}

// Run the comprehensive extractor
console.log('🎯 Starting PUMA Inventory Extraction...');
console.log(`📦 Collection: ${CONFIG.collection.displayName}`);
console.log(`🌐 URL: ${CONFIG.collection.url}`);
console.log(`📧 Email recipients: ${CONFIG.email.recipients.join(', ')}`);
console.log('This will extract all available products from the specified PUMA collection\n');

extractAllPumaShoes()
  .then(async (result) => {
    const { products, filename } = result;
    
    console.log(`\n🏆 EXTRACTION COMPLETE!`);
    console.log(`📈 Total products extracted: ${products.length}`);
    console.log(`💎 Products are formatted for Shopify import`);
    console.log(`📋 CSV includes: Handle, Title, Image Src, Product URL, Price, Product ID`);
    
    if (products.length === 0) {
      console.log('❌ No products were extracted. This could be due to:');
      console.log('   - Website changes or anti-bot measures');
      console.log('   - Network connectivity issues');
      console.log('   - Page loading timeout');
      console.log('   - Invalid collection URL');
    } else {
      console.log('🎉 SUCCESS! Your PUMA inventory is ready for import.');
      
      // Send email with CSV attachment
      console.log('\n📧 Sending email with CSV attachment...');
      const emailSent = await sendEmailWithCSV(filename);
      
      if (emailSent) {
        console.log('✅ Email sent successfully with CSV attachment!');
      } else {
        console.log('⚠️  Email not sent, but CSV file is available locally');
      }
    }
  })
  .catch(error => {
    console.error('💥 Extraction failed:', error.message);
  });
