import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
import { writeToPath } from '@fast-csv/format';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

// Configuration for Etam
const CONFIG = {
  collection: {
    name: process.env.COLLECTION_NAME || 'etam-nightwear',
    url: process.env.COLLECTION_URL || 'https://int.etam.com/en_KE/c/nightwear/new-arrivals/',
    displayName: process.env.COLLECTION_DISPLAY_NAME || 'Etam Nightwear New Arrivals'
  },
  
  email: {
    recipients: ['nigel@shopzetu.com', 'patrick@shopzetu.com'],
    sender: process.env.SENDER_EMAIL,
    password: process.env.SENDER_PWD,
    subject: `${process.env.COLLECTION_DISPLAY_NAME || 'Etam Nightwear New Arrivals'} Inventory Extract - ${new Date().toLocaleDateString()}`
  }
};

async function extractEtamProducts() {
  let browser;
  try {
    console.log('🚀 Starting Etam Product Extraction...');
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
    console.log(`🌐 Loading Etam page...`);
    await page.goto(CONFIG.collection.url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait a bit for the page to load
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Function to extract products from current page state
    const extractCurrentPageProducts = async () => {
      return await page.evaluate(() => {
        const products = [];
        
        // Try multiple selectors for Etam products
        const possibleSelectors = [
          '.product-tile',
          '[class*="product"]',
          '.grid-tile',
          '[data-pid]',
          '.product-item'
        ];
        
        let productElements = [];
        for (const selector of possibleSelectors) {
          productElements = document.querySelectorAll(selector);
          if (productElements.length > 0) {
            console.log(`Found ${productElements.length} products with selector: ${selector}`);
            break;
          }
        }
        
        // If no products found with specific selectors, try to find links to product pages
        if (productElements.length === 0) {
          productElements = document.querySelectorAll('a[href*="/p/"]');
          console.log(`Found ${productElements.length} product links`);
        }
        
        productElements.forEach((element, index) => {
          try {
            let title = '';
            let price = '';
            let image = '';
            let link = '';
            let productId = '';
            
            // For Etam, try different approaches to get product info
            if (element.href && element.href.includes('/p/')) {
              // This is a product link
              link = element.href;
              
              // Try to get title from the link text or nearby elements
              title = element.textContent?.trim() || 
                     element.getAttribute('title') || 
                     element.querySelector('img')?.getAttribute('alt') || '';
              
              // Look for price in parent or nearby elements
              const parent = element.closest('.product-tile, [class*="product"], .grid-tile') || element.parentElement;
              if (parent) {
                const priceElement = parent.querySelector('.price, [class*="price"], .product-price');
                if (priceElement) {
                  price = priceElement.textContent?.trim() || '';
                }
                
                // Look for image
                const imgElement = parent.querySelector('img');
                if (imgElement) {
                  image = imgElement.src || imgElement.getAttribute('data-src') || '';
                }
                
                // If title is still empty, try other selectors in parent
                if (!title) {
                  const titleElements = parent.querySelectorAll('h1, h2, h3, h4, .product-name, .product-title, [class*="title"]');
                  for (const titleEl of titleElements) {
                    const text = titleEl.textContent?.trim();
                    if (text && text.length > 2) {
                      title = text;
                      break;
                    }
                  }
                }
              }
            } else {
              // This is a product container
              const titleElement = element.querySelector('h1, h2, h3, h4, .product-name, .product-title, [class*="title"], a[href*="/p/"]');
              const priceElement = element.querySelector('.price, [class*="price"], .product-price');
              const imageElement = element.querySelector('img');
              const linkElement = element.querySelector('a[href*="/p/"]');
              
              if (titleElement) {
                title = titleElement.textContent?.trim() || titleElement.getAttribute('title') || '';
              }
              
              if (priceElement) {
                price = priceElement.textContent?.trim() || '';
              }
              
              if (imageElement) {
                image = imageElement.src || imageElement.getAttribute('data-src') || '';
              }
              
              if (linkElement) {
                link = linkElement.href || '';
              }
            }
            
            // Clean up the title for Etam products
            if (title) {
              // Remove price from title if it got mixed in
              title = title.replace(/\d+[,.]?\d*\s*€.*$/, '').trim();
              // Remove extra whitespace
              title = title.replace(/\s+/g, ' ').trim();
            }
            
            // Clean up price
            if (price) {
              // Extract just the price part
              const priceMatch = price.match(/\d+[,.]?\d*\s*€/);
              if (priceMatch) {
                price = priceMatch[0];
              }
            }
            
            // Make sure image and link are absolute URLs
            if (image && image.startsWith('/')) {
              image = 'https://www.etam.com' + image;
            }
            if (link && link.startsWith('/')) {
              link = 'https://www.etam.com' + link;
            }
            
            // Generate product ID
            productId = element.getAttribute('data-pid') || 
                       element.getAttribute('data-product-id') ||
                       (link.match(/\/p\/.*?(\d+)/) && link.match(/\/p\/.*?(\d+)/)[1]) ||
                       `etam-${index}`;
            
            // Only add if we have meaningful data
            if (title && title.length > 2) {
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
    
    if (products.length === 0) {
      console.log('⚠️ No products found with initial selectors. Trying alternative approach...');
      
      // Try to find any text that looks like product names
      const alternativeProducts = await page.evaluate(() => {
        const products = [];
        const links = document.querySelectorAll('a[href*="/p/"]');
        
        links.forEach((link, index) => {
          const title = link.textContent?.trim() || link.getAttribute('title') || '';
          if (title && title.length > 5) {
            products.push({
              title: title,
              price: '',
              image: '',
              link: link.href,
              productId: `etam-alt-${index}`,
              extractedAt: new Date().toISOString()
            });
          }
        });
        
        return products;
      });
      
      products = alternativeProducts;
      console.log(`Found ${products.length} products with alternative method`);
    }
    
    products.forEach(product => {
      allProducts.add(JSON.stringify(product));
    });

    // Scroll to load more products
    console.log('📜 Scrolling to load more products...');
    let previousCount = products.length;
    let scrollAttempts = 0;
    const maxScrollAttempts = 5;

    while (scrollAttempts < maxScrollAttempts) {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const newProducts = await extractCurrentPageProducts();
      console.log(`Scroll ${scrollAttempts + 1}: Found ${newProducts.length} total products on page`);
      
      newProducts.forEach(product => {
        allProducts.add(JSON.stringify(product));
      });
      
      if (newProducts.length === previousCount) {
        console.log('No new products found, stopping scroll attempts');
        break;
      }
      
      previousCount = newProducts.length;
      scrollAttempts++;
    }

    // Convert Set back to array and parse JSON
    const finalProducts = Array.from(allProducts).map(productStr => JSON.parse(productStr));
    
    console.log(`\n📊 Extraction Summary:`);
    console.log(`Total unique products found: ${finalProducts.length}`);
    
    if (finalProducts.length > 0) {
      console.log('Sample products:');
      finalProducts.slice(0, 5).forEach((product, index) => {
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
          'Extraction Method': 'Etam Scraper',
          'Extracted At': product.extractedAt
        };
      });
      
      const filename = await saveToCSV(shopifyProducts);
      return { products: shopifyProducts, filename };
    }

    return { products: [], filename: null };

  } catch (error) {
    console.error('❌ Error during extraction:', error.message);
    return { products: [], filename: null };
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

async function sendEmailWithCSV(csvFilename) {
  if (!csvFilename || !CONFIG.email.sender || !CONFIG.email.password) {
    console.log('⚠️ Email not sent - missing CSV file, sender email, or password');
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
        <li><strong>Collection:</strong> ${CONFIG.collection.displayName}</li>
        <li><strong>File Size:</strong> ${fileSizeKB} KB</li>
        <li><strong>Generated:</strong> ${new Date().toLocaleString()}</li>
        <li><strong>Format:</strong> Shopify-ready CSV</li>
      </ul>

      <p><em>Generated by Etam Product Scraper</em></p>
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

// Run the Etam extractor
console.log('🇫🇷 Starting Etam Product Scraper...');

extractEtamProducts()
  .then(async (result) => {
    const { products, filename } = result;
    
    console.log(`\n🏆 EXTRACTION COMPLETE!`);
    console.log(`📈 Total products extracted: ${products.length}`);
    
    if (products.length === 0) {
      console.log('❌ No products were extracted. This could be due to:');
      console.log('   - Etam website changes or anti-bot measures');
      console.log('   - Network connectivity issues');
      console.log('   - Page loading timeout');
    } else {
      console.log('🎉 SUCCESS! Your Etam inventory is ready for import.');
      
      // Send email with CSV attachment
      console.log('\n📧 Sending email with CSV attachment...');
      const emailSent = await sendEmailWithCSV(filename);
      
      if (emailSent) {
        console.log('✅ Email sent successfully with CSV attachment!');
      } else {
        console.log('⚠️ Email not sent, but CSV file is available locally');
      }
    }
  })
  .catch(error => {
    console.error('💥 Extraction failed:', error.message);
  });
