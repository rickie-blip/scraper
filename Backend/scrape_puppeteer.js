import puppeteer from "puppeteer";
import fs from "fs";
import { Parser } from "json2csv";

const BASE_URL = "https://us.puma.com";
const CATEGORY_URL = `${BASE_URL}/us/en/men/shoes`;

async function scrapePumaWithPuppeteer(limit = 10) {
  let browser;
  
  try {
    console.log("🚀 Launching browser...");
    browser = await puppeteer.launch({
      headless: false, // Show browser window for debugging
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ width: 1366, height: 768 });
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Remove automation indicators
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });
    
    console.log("📄 Loading page:", CATEGORY_URL);
    try {
      await page.goto(CATEGORY_URL, { 
        waitUntil: "domcontentloaded",
        timeout: 60000 
      });
    } catch (navError) {
      console.log("⚠️ Navigation timed out, trying to continue anyway...");
    }
    
    // Wait a bit more for dynamic content
    console.log("⏳ Waiting for products to load...");
    await page.waitForTimeout(10000);
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'debug_screenshot.png' });
    console.log("📸 Screenshot saved as debug_screenshot.png");
    
    // Check if page loaded correctly
    const title = await page.title();
    console.log("📋 Page title:", title);
    
    // Try to find products with various selectors
    const selectors = [
      '[data-testid*="product"]',
      '.product-tile',
      '.product-card',
      '.product-item',
      '[class*="product"]',
      'article[class*="grid"]',
      '.pdp-link',
      'a[href*="/product/"]',
      'a[href*="/shoes/"]'
    ];
    
    let products = [];
    
    for (const selector of selectors) {
      console.log(`🔍 Trying selector: ${selector}`);
      
      try {
        const elements = await page.$$(selector);
        console.log(`   Found ${elements.length} elements`);
        
        if (elements.length > 0) {
          const extractedProducts = await page.evaluate((sel, lim) => {
            const products = [];
            const elements = document.querySelectorAll(sel);
            
            for (let i = 0; i < Math.min(elements.length, lim); i++) {
              const el = elements[i];
              
              // Try to extract product information
              const titleEl = el.querySelector('h1, h2, h3, h4, h5, [class*="title"], [class*="name"], [data-testid*="title"], [data-testid*="name"], span');
              const priceEl = el.querySelector('[class*="price"], [class*="cost"], [data-testid*="price"]');
              const linkEl = el.querySelector('a') || el;
              const imgEl = el.querySelector('img');
              
              const title = titleEl ? titleEl.textContent.trim() : '';
              const price = priceEl ? priceEl.textContent.trim() : '';
              const link = linkEl ? linkEl.href || linkEl.getAttribute('href') : '';
              const imageSrc = imgEl ? (imgEl.dataset.src || imgEl.src || imgEl.dataset.lazySrc) : '';
              
              if (title || imageSrc || (link && (link.includes('product') || link.includes('shoes')))) {
                const handle = title ? title.toLowerCase().replace(/\\s+/g, "-").replace(/[\/\\\\]/g, "-") : `product-${i}`;
                
                products.push({
                  Handle: handle,
                  Title: title || "No title found",
                  Price: price || "No price found",
                  "Product URL": link || "No URL found",
                  "Image Src": imageSrc || "No image found"
                });
              }
            }
            
            return products;
          }, selector, limit);
          
          if (extractedProducts.length > 0) {
            products = extractedProducts;
            console.log(`✅ Successfully extracted ${products.length} products using selector: ${selector}`);
            break;
          }
        }
      } catch (error) {
        console.log(`   Error with selector ${selector}:`, error.message);
      }
    }
    
    // If still no products, try to scroll and wait for lazy loading
    if (products.length === 0) {
      console.log("📜 Trying to scroll to trigger lazy loading...");
      await page.evaluate(() => {
        window.scrollBy(0, 1000);
      });
      await page.waitForTimeout(5000);
      
      // Try again with a broader search
      const allLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        return links
          .filter(link => 
            link.href.includes('/product/') || 
            link.href.includes('/shoes/') ||
            (link.querySelector('img') && link.textContent.trim()) ||
            link.href.match(/\/[a-z-]+-\d+/)
          )
          .slice(0, 20)
          .map(link => ({
            title: link.textContent.trim() || link.querySelector('img')?.alt || link.getAttribute('title') || '',
            url: link.href,
            image: link.querySelector('img')?.src || link.querySelector('img')?.dataset.src || ''
          }))
          .filter(link => link.title.length > 0 || link.image.length > 0);
      });
      
      if (allLinks.length > 0) {
        products = allLinks.map((link, i) => ({
          Handle: link.title ? link.title.toLowerCase().replace(/\\s+/g, "-").replace(/[\/\\\\]/g, "-") : `product-${i}`,
          Title: link.title || "No title found",
          Price: "Price not available",
          "Product URL": link.url,
          "Image Src": link.image || "No image found"
        }));
        console.log(`✅ Found ${products.length} product links via broad search`);
      }
    }
    
    // Save page content for debugging
    const content = await page.content();
    require('fs').writeFileSync('debug_page_puppeteer.html', content);
    console.log("💾 Page content saved to debug_page_puppeteer.html");
    
    return products;
    
  } catch (error) {
    console.error("❌ Error during scraping:", error.message);
    return [];
  } finally {
    if (browser) {
      // Keep browser open for a moment to see what happened
      console.log("⏳ Keeping browser open for 5 seconds for debugging...");
      await new Promise(resolve => setTimeout(resolve, 5000));
      await browser.close();
    }
  }
}

async function saveToCSV(products) {
  if (products.length === 0) {
    console.log("⚠️ No products to save");
    return;
  }
  
  const parser = new Parser({ 
    fields: ["Handle", "Title", "Price", "Product URL", "Image Src"] 
  });
  const csv = parser.parse(products);
  fs.writeFileSync("puma_products_puppeteer.csv", csv);
  console.log(`✅ CSV saved: puma_products_puppeteer.csv (${products.length} products)`);
}

(async () => {
  const products = await scrapePumaWithPuppeteer(20);
  console.log(`\\n📊 Total products found: ${products.length}`);
  
  if (products.length > 0) {
    // Show first few products
    console.log("\\n🔍 Sample products:");
    products.slice(0, 3).forEach((product, i) => {
      console.log(`${i + 1}. ${product.Title} - ${product.Price}`);
      console.log(`   URL: ${product["Product URL"]}`);
    });
    
    await saveToCSV(products);
  } else {
    console.log("⚠️ No products found. The site might be using complex anti-bot protection or the structure has changed significantly.");
  }
})();
