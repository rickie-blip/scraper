import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const COLLECTION_URL =
  "https://nalaniwomen.com/search?q=BODYSUITS&options%5Bprefix%5D=last";

const OUTPUT_FILE = "nalani_products_shopify.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const formatPrice = (value) =>
  value ? `KES ${(value / 100).toLocaleString()}` : "";

export default async function scrapeCollection(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  console.log(`➡️ Loading collection: ${url}`);
  await page.goto(url, { waitUntil: "networkidle2" });

  /* ----------------------------------------
     Scroll to load all products
  ---------------------------------------- */
  let previousHeight = 0;
  while (true) {
    const currentHeight = await page.evaluate(
      () => document.body.scrollHeight
    );
    if (currentHeight === previousHeight) break;
    previousHeight = currentHeight;

    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight)
    );

    await sleep(1000);
  }

  /* ----------------------------------------
     Collect unique product URLs
  ---------------------------------------- */
  const productLinks = await page.evaluate(() => {
    return [
      ...new Set(
        Array.from(document.querySelectorAll("a[href*='/products/']")).map(
          (a) => a.href.split("?")[0]
        )
      ),
    ];
  });

  console.log(`➡️ Found ${productLinks.length} products\n`);

  const products = [];

  /* ----------------------------------------
     Fetch product data via Shopify .js
  ---------------------------------------- */
  for (const [index, link] of productLinks.entries()) {
    try {
      console.log(`➡️ [${index + 1}/${productLinks.length}] ${link}`);

      const jsonUrl = `${link}.js`;

      const product = await page.evaluate(async (jsonUrl) => {
        const res = await fetch(jsonUrl);
        const data = await res.json();

        const variants = data.variants || [];

        const formatPrice = (value) =>
          value ? `KES ${(value / 100).toLocaleString()}` : "";

        const normalizeImageUrl = (src) => {
          if (!src) return "";

          // protocol-relative → absolute
          if (src.startsWith("//")) {
            src = "https:" + src;
          }

          // remove Shopify sharded storage path
          src = src.replace(
            /\/cdn\/shop\/s\/files\/[^/]+\/files\//,
            "/cdn/shop/files/"
          );

          return src;
        };

        return {
          title: data.title || "",
          description: data.body_html || "",
          price: formatPrice(variants[0]?.price),
          compareAtPrice: formatPrice(variants[0]?.compare_at_price),
          images: (data.images || []).map(normalizeImageUrl),
          sizes: [
            ...new Set(
              variants
                .map((v) => v.option1)
                .filter((v) => v && v !== "Default Title")
            ),
          ],
        };
      }, jsonUrl);

      product.url = link;
      products.push(product);

      console.log(
        `   ✅ ${product.title} | ${product.images.length} images | ${product.sizes.length} sizes`
      );

      await sleep(400);
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}`);
    }
  }

  await browser.close();

  fs.writeFileSync(
    path.resolve(OUTPUT_FILE),
    JSON.stringify(products, null, 2)
  );

  console.log(`\n🎉 Done! Extracted ${products.length} products`);
  console.log(`💾 Saved to ${OUTPUT_FILE}`);
}

scrapeCollection(COLLECTION_URL).catch(console.error);
