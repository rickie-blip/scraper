import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const COLLECTION_URL = "https://leorana.com/collections/womens-puma-new-drop-august-2025";
const OUTPUT_FILE = "leorana_products_shopify.json";

async function scrapeCollection(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  console.log(`➡️ Loading collection page: ${url}`);
  await page.goto(url, { waitUntil: "networkidle2" });

  // Scroll to bottom to load all products
  let prevHeight = 0;
  while (true) {
    const newHeight = await page.evaluate("document.body.scrollHeight");
    if (newHeight === prevHeight) break;
    prevHeight = newHeight;
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Get unique product URLs
  const productLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href*='/products/']"))
      .map(a => a.href)
      .filter((v, i, a) => a.indexOf(v) === i)
  );

  console.log(`➡️ Found ${productLinks.length} products`);

  const products = [];

  for (const [index, link] of productLinks.entries()) {
    try {
      console.log(`➡️ [${index + 1}/${productLinks.length}] ${link}`);
      await page.goto(link, { waitUntil: "networkidle2" });

      const product = await page.evaluate(() => {
        const title = document.querySelector("h1")?.textContent.trim() || "";

        // Only select the main product gallery images
        const images = Array.from(document.querySelectorAll(".product__media img"))
          .map(img => img.src)
          .filter(src => src && !src.includes("logo") && !src.includes("banner"));

        // Price
        const price = document.querySelector(".price__regular")?.textContent.trim() ||
                      document.querySelector(".product__price")?.textContent.trim() || "";

        // Compare-at price if exists
        const compareAtPrice = document.querySelector(".price__sale")?.textContent.trim() || "";

        // Description under Product Details
        const description = document.querySelector(".product__description")?.textContent.trim() ||
                            document.querySelector("[id*='ProductDetails']")?.textContent.trim() || "";

        return { title, price, compareAtPrice, images, description };
      });

      product.url = link;
      console.log(`   ✅ Extracted: ${product.title} - ${product.price} (${product.images.length} images)`);
      products.push(product);

      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(`   ❌ Failed: ${err.message}`);
    }
  }

  await browser.close();

  fs.writeFileSync(path.resolve(OUTPUT_FILE), JSON.stringify(products, null, 2));
  console.log(`\n🎉 Done! Extracted ${products.length} products`);
  console.log(`💾 Saved to ${OUTPUT_FILE}`);

  return products;
}

scrapeCollection(COLLECTION_URL).catch(console.error);
