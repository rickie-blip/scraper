import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
import { writeToPath } from '@fast-csv/format';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

// Website-specific configurations
const SITE_CONFIGS = {
  puma: {
    baseUrl: 'https://us.puma.com',
    selectors: {
      productContainer: '[data-product-id]',
      title: 'h1, h2, h3, h4, .title, .name, [data-testid*="title"], [data-testid*="name"], a[href*="/pd/"]',
      price: '.price, [data-testid*="price"], .cost, .amount, [class*="price"]',
      image: 'img',
      link: 'a[href*="/pd/"], a',
      loadMore: 'button[data-testid*="load-more"], .load-more, [class*="load-more"]'
    },
    titleCleanup: {
      removeColorCount: true,
      patterns: [
        /(.*?)\s+(Men's|Women's|Kids'|Unisex)\s+(Basketball|Running|Training|Soccer|Lifestyle|Casual)\s+(Shoes|Sneakers|Cleats)/i,
        /(.*?)\s+(Men's|Women's|Kids'|Unisex)\s+(Shoes|Sneakers|Clothing|Hoodie|Tee|Jersey|Shorts|Pants)/i,
        /(.*?)\s+(Team\s+[A-Z][a-z]+|PUMA\s+[A-Z][a-z]+|[A-Z][a-z]+-[A-Z][a-z]+)/i,
        /(.*?)\s*\$\d+\.\d+/,
        /(.*?)\s+(New|Best Seller|Sale|Exclusive)/i
      ]
    }
  },
  
  etam: {
    baseUrl: 'https://www.etam.com',
    selectors: {
      productContainer: '.product-tile, [class*="product"], .grid-tile',
      title: '.product-name, .product-title, h3, h4, a[href*="/p/"]',
      price: '.price, .product-price, [class*="price"]',
      image: '.product-image img, .tile-image img, img',
      link: 'a[href*="/p/"], .product-link, a',
      loadMore: '.load-more, [class*="load-more"], button[class*="show-more"]'
    },
    titleCleanup: {
      removeColorCount: false,
      patterns: [
        /(.*?)\s+\d+,\d+\s*€/,  // Remove price in euros
        /(.*?)\s+(Body|Soutien-gorge|Culotte)/i  // Remove product type from end
      ]
    }
  },
  
  generic: {
    baseUrl: '',
    selectors: {
      productContainer: '[data-product], .product, .item, .grid-item',
      title: 'h1, h2, h3, h4, .title, .name, .product-name, .product-title',
      price: '.price, .cost, .amount, [class*="price"]',
      image: 'img',
      link: 'a',
      loadMore: '.load-more, [class*="load-more"], button[class*="more"]'
    },
    titleCleanup: {
      removeColorCount: false,
      patterns: []
    }
  }
};

// Configuration
const CONFIG = {
  // Site configuration - auto-detected or manually set
  site: process.env.SITE_TYPE || 'auto', // 'puma', 'etam', 'generic', or 'auto'
  
  // Collection configuration
  collection: {
    name: process.env.COLLECTION_NAME || 'products',
    url: process.env.COLLECTION_URL || '',
    displayName: process.env.COLLECTION_DISPLAY_NAME || 'Products'
  },
  
  // Email configuration
  email: {
    recipients: ['nigel@shopzetu.com', 'patrick@shopzetu.com'],
    sender: process.env.SENDER_EMAIL,
    password: process.env.SENDER_PWD,
    subject: `${process.env.COLLECTION_DISPLAY_NAME || 'Products'} Inventory Extract - ${new Date().toLocaleDateString()}`
  }
};

// Auto-detect site type from URL
function detectSiteType(url) {
  if (url.includes('puma.com')) return 'puma';
  if (url.includes('etam.com')) return 'etam';
  return 'generic';
}

// Get site configuration
function getSiteConfig() {
  const siteType = CONFIG.site === 'auto' ? detectSiteType(CONFIG.collection.url) : CONFIG.site;
  return SITE_CONFIGS[siteType] || SITE_CONFIGS.generic;
}

async function extractProducts() {
  let browser;
  try {
    const siteConfig = getSiteConfig();
    const siteType = CONFIG.site === 'auto' ? detectSiteType(CONFIG.collection.url) : CONFIG.site;
    
    console.log('🚀 Starting Universal Product Extraction...');
    console.log(`🌐 Site Type: ${siteType.toUpperCase()}`);
    console.log(`📦 Collection: ${CONFIG.collection.displayName}`);
    console.log(`🔗 URL: ${CONFIG.collection.url}`);
    
    browser = await puppeteer.launch({
      headless: true,
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
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const allProducts = new Set();
    
    // Navigate to the page
    console.log(`🌐 Loading ${CONFIG.collection.displayName} page...`);
    await page.goto(CONFIG.collection.url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for products to load
    await page.waitForTimeout(3000);

    // Function to extract products from current page state
    const extractCurrentPageProducts = async () => {
      return await page.evaluate((config) => {
        const products = [];
        const productElements = document.querySelectorAll(config.selectors.productContainer);
        
        productElements.forEach((element, index) => {
          try {
            // Extract product data using site-specific selectors
            const titleElement = element.querySelector(config.selectors.title);
            const priceElement = element.querySelector(config.selectors.price);
            const imageElement = element.querySelector(config.selectors.image);
            const linkElement = element.querySelector(config.selectors.link);
            
            let title = '';
            let price = '';
            let image = '';
            let link = '';
            let productId = '';
            
            // Extract title
            if (titleElement) {
              title = titleElement.textContent?.trim() || titleElement.getAttribute('title') || '';
              
              // Site-specific title cleanup
              if (title && config.titleCleanup) {
                // Remove color count prefixes for sites like PUMA
                if (config.titleCleanup.removeColorCount) {
                  title = title.replace(/^\d+\s+Colors?\s*/i, '');
                }
                
                // Apply site-specific patterns
                for (const pattern of config.titleCleanup.patterns) {
                  const match = title.match(pattern);
                  if (match && match[1] && match[1].trim().length >= 3) {
                    title = match[1].trim();
                    break;
                  }
                }
                
                // Final cleanup
                title = title.replace(/\s+/g, ' ').trim();
              }
            }
            
            // Extract price
            if (priceElement) {
              price = priceElement.textContent?.trim() || '';
              // Clean up price (remove extra text, keep only price)
              price = price.replace(/[^0-9.,€$]/g, ' ').trim();
            }
            
            // Extract image
            if (imageElement) {
              image = imageElement.src || imageElement.getAttribute('data-src') || imageElement.getAttribute('data-lazy-src') || '';
              // Make absolute URL if needed
              if (image && image.startsWith('/')) {
                image = config.baseUrl + image;
              }
            }
            
            // Extract link
            if (linkElement) {
              link = linkElement.href || linkElement.getAttribute('href') || '';
              // Make absolute URL if needed
              if (link && link.startsWith('/')) {
                link = config.baseUrl + link;
              }
            }
            
            // Generate product ID
            productId = element.getAttribute('data-product-id') || 
                       element.getAttribute('data-productid') ||
                       element.getAttribute('data-id') ||
                       (link.match(/\/(\d+)/) && link.match(/\/(\d+)/)[1]) ||
                       `product-${index}`;
            
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
      }, siteConfig);
    };

    // Extract initial products
    console.log('📦 Extracting initial products...');
    let products = await extractCurrentPageProducts();
    console.log(`Found ${products.length} products on initial load`);
    
    products.forEach(product => {
      allProducts.add(JSON.stringify(product));
    });

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
      await page.waitForTimeout(2000);
      
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

    // Look for "Load More" buttons
    console.log('🔍 Looking for Load More buttons...');
    try {
      const loadMoreSelectors = siteConfig.selectors.loadMore.split(', ');
      
      for (const selector of loadMoreSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            console.log(`Found Load More button with selector: ${selector}`);
            await button.click();
            await page.waitForTimeout(3000);
            
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
          'Product URL': product.link || '',
          Price: product.price || '',
          'Product ID': product.productId,
          'Extraction Method': `Universal Scraper (${siteType})`,
          'Extracted At': product.extractedAt
        };
      });
      
      const filename = await saveToCSV(shopifyProducts);
      return { products: shopifyProducts, filename, siteType };
    }

    return { products: [], filename: null, siteType };

  } catch (error) {
    console.error('❌ Error during extraction:', error.message);
    return { products: [], filename: null, siteType: 'unknown' };
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
  const filename = `${CONFIG.collection.name}_${timestamp}.csv`;
  
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

async function sendEmailWithCSV(csvFilename, siteType) {
  if (!csvFilename || !CONFIG.email.sender || !CONFIG.email.password) {
    console.log('⚠️  Email not sent - missing CSV file, sender email, or password');
    return false;
  }

  try {
    console.log('📧 Setting up email transporter...');
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: CONFIG.email.sender,
        pass: CONFIG.email.password
      }
    });

    await transporter.verify();
    console.log('✅ Email server connection verified');

    const stats = fs.statSync(csvFilename);
    const fileSizeKB = Math.round(stats.size / 1024);

    const emailHtml = `
      <h2>🎯 ${CONFIG.collection.displayName} Inventory Extract</h2>
      <p><strong>Extraction completed successfully!</strong></p>
      
      <h3>📊 Summary:</h3>
      <ul>
        <li><strong>Site:</strong> ${siteType.toUpperCase()}</li>
        <li><strong>Collection:</strong> ${CONFIG.collection.displayName}</li>
        <li><strong>File Size:</strong> ${fileSizeKB} KB</li>
        <li><strong>Generated:</strong> ${new Date().toLocaleString()}</li>
        <li><strong>Format:</strong> Shopify-ready CSV</li>
      </ul>

      <p><em>Generated by Universal Product Scraper</em></p>
    `;

    const info = await transporter.sendMail({
      from: CONFIG.email.sender,
      to: CONFIG.email.recipients.join(', '),
      subject: CONFIG.email.subject,
      html: emailHtml,
      attachments: [{
        filename: csvFilename,
        path: path.resolve(csvFilename),
        contentType: 'text/csv'
      }]
    });
    
    console.log('✅ Email sent successfully!');
    console.log(`📧 Message ID: ${info.messageId}`);
    
    return true;

  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
    return false;
  }
}

// Run the universal extractor
console.log('🌐 Starting Universal Product Scraper...');
console.log(`📦 Collection: ${CONFIG.collection.displayName}`);
console.log(`🔗 URL: ${CONFIG.collection.url}`);
console.log(`📧 Email recipients: ${CONFIG.email.recipients.join(', ')}`);
console.log(`🔧 Debug - CONFIG:`, JSON.stringify(CONFIG, null, 2));

if (!CONFIG.collection.url) {
  console.error('❌ No collection URL provided. Set COLLECTION_URL environment variable.');
  process.exit(1);
}

extractProducts()
  .then(async (result) => {
    const { products, filename, siteType } = result;
    
    console.log(`\n🏆 EXTRACTION COMPLETE!`);
    console.log(`🌐 Site Type: ${siteType?.toUpperCase() || 'UNKNOWN'}`);
    console.log(`📈 Total products extracted: ${products.length}`);
    
    if (products.length === 0) {
      console.log('❌ No products were extracted. This could be due to:');
      console.log('   - Unsupported website structure');
      console.log('   - Network connectivity issues');
      console.log('   - Anti-bot measures');
      console.log('   - Invalid collection URL');
    } else {
      console.log('🎉 SUCCESS! Your inventory is ready for import.');
      
      // Send email with CSV attachment
      console.log('\n📧 Sending email with CSV attachment...');
      const emailSent = await sendEmailWithCSV(filename, siteType);
      
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
