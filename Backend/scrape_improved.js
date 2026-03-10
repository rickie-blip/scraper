import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import { Parser } from "json2csv";

const BASE_URL = "https://us.puma.com";
const CATEGORY_URL = `${BASE_URL}/us/en/men/shoes`;

async function scrapePumaProductsFromJSON() {
  try {
    console.log("🚀 Fetching page...");
    const response = await axios.get(CATEGORY_URL, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 30000
    });

    const $ = cheerio.load(response.data);
    const products = [];

    // Look for Next.js data
    const nextDataScript = $('script#__NEXT_DATA__').html();
    if (nextDataScript) {
      console.log("✅ Found Next.js data, parsing...");
      try {
        const nextData = JSON.parse(nextDataScript);
        
        // Look for product data in buildManifest or other locations
        const jsonString = JSON.stringify(nextData);
        
        // Extract product information using regex patterns
        const productPatterns = [
          /"productId":"([^"]+)"/g,
          /"productName":"([^"]+)"/g,
          /"masterId":"([^"]+)"/g,
          /"subHeader":"([^"]+)"/g
        ];
        
        // Find all product data
        const productIdMatches = [...jsonString.matchAll(/"productId":"([^"]+)"/g)];
        const productNameMatches = [...jsonString.matchAll(/"productName":"([^"]+)"/g)];
        const masterIdMatches = [...jsonString.matchAll(/"masterId":"([^"]+)"/g)];
        const subHeaderMatches = [...jsonString.matchAll(/"subHeader":"([^"]+)"/g)];
        
        console.log(`Found ${productIdMatches.length} product IDs`);
        console.log(`Found ${productNameMatches.length} product names`);
        
        // Create products array
        const minLength = Math.min(
          productIdMatches.length, 
          productNameMatches.length, 
          masterIdMatches.length,
          subHeaderMatches.length
        );
        
        for (let i = 0; i < minLength; i++) {
          const productId = productIdMatches[i][1];
          const productName = productNameMatches[i][1];
          const masterId = masterIdMatches[i][1];
          const subHeader = subHeaderMatches[i][1];
          
          // Generate product URL and handle
          const handle = productName.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
          
          const productUrl = `${BASE_URL}/us/en/product/${productId}`;
          const imageUrl = `${BASE_URL}/dw/image/v2/BDWH_PRD/on/demandware.static/-/Sites-puma-master-catalog/default/dw${Math.random().toString(36).substring(2, 15)}/${productId}-1.jpg`;
          
          products.push({
            Handle: handle,
            Title: productName,
            "Product ID": productId,
            "Master ID": masterId,
            "Sub Header": subHeader,
            "Product URL": productUrl,
            "Image Src": imageUrl,
            Price: "Price available on product page"
          });
        }
        
        // Remove duplicates based on product ID
        const uniqueProducts = products.reduce((acc, current) => {
          const existingProduct = acc.find(product => product["Product ID"] === current["Product ID"]);
          if (!existingProduct) {
            acc.push(current);
          }
          return acc;
        }, []);
        
        console.log(`✅ Extracted ${uniqueProducts.length} unique products`);
        return uniqueProducts;
        
      } catch (parseError) {
        console.error("Failed to parse Next.js data:", parseError.message);
      }
    }

    // Fallback: Try to extract from visible HTML
    console.log("🔍 Trying to extract from visible HTML...");
    const fallbackProducts = [];
    
    // Look for any links that might be products
    $('a[href*="/product/"], a[href*="/shoes/"]').each((i, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      const text = $el.text().trim();
      const img = $el.find('img').first();
      const imgSrc = img.attr('src') || img.attr('data-src');
      
      if (text && href) {
        fallbackProducts.push({
          Handle: text.toLowerCase().replace(/\s+/g, '-'),
          Title: text,
          "Product URL": href.startsWith('http') ? href : BASE_URL + href,
          "Image Src": imgSrc ? (imgSrc.startsWith('http') ? imgSrc : BASE_URL + imgSrc) : 'No image',
          Price: "Price available on product page"
        });
      }
    });
    
    console.log(`Found ${fallbackProducts.length} products from HTML`);
    return fallbackProducts.length > 0 ? fallbackProducts : products;
    
  } catch (error) {
    console.error("❌ Error during scraping:", error.message);
    return [];
  }
}

async function saveToCSV(products) {
  if (products.length === 0) {
    console.log("⚠️ No products to save");
    return;
  }
  
  const fields = Object.keys(products[0]);
  const parser = new Parser({ fields });
  const csv = parser.parse(products);
  fs.writeFileSync("puma_products_extracted.csv", csv);
  console.log(`✅ CSV saved: puma_products_extracted.csv (${products.length} products)`);
}

(async () => {
  const products = await scrapePumaProductsFromJSON();
  console.log(`\n📊 Total products found: ${products.length}`);
  
  if (products.length > 0) {
    // Show first few products
    console.log("\n🔍 Sample products:");
    products.slice(0, 5).forEach((product, i) => {
      console.log(`${i + 1}. ${product.Title}`);
      console.log(`   ID: ${product["Product ID"] || "N/A"}`);
      console.log(`   URL: ${product["Product URL"]}`);
    });
    
    await saveToCSV(products);
  } else {
    console.log("⚠️ No products found.");
  }
})();
