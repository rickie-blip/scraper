import  puppeteer from "puppeteer";
import fs from "fs";
import csvWriter from "csv-writer";
const createCsvWriter = csvWriter.createObjectCsvWriter;

const COLLECTION_URL = "https://us.puma.com/us/en/men/shoes";

const writeCSV = createCsvWriter({
  path: "puma_products.csv",
  header: [
    { id: "name", title: "Product Name" },
    { id: "price", title: "Price" },
    { id: "image", title: "Image URL" },
    { id: "link", title: "Product Link" },
  ],
});

async function scrapePumaCollection() {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.goto(COLLECTION_URL, { waitUntil: "networkidle2" });

  // Optional: Scroll to load more products
  await autoScroll(page);

  const products = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-test-id="product-grid-item"]');
    const items = [];

    cards.forEach((card) => {
      const name = card.querySelector('[data-test-id="product-name"]')?.textContent?.trim();
      const price = card.querySelector('[data-test-id="product-price"]')?.textContent?.trim();
      const link = card.querySelector("a")?.href;
      const image = card.querySelector("img")?.src;

      if (name && price && link) {
        items.push({ name, price, link, image });
      }
    });

    return items;
  });

  console.log(`✅ Scraped ${products.length} products`);

  await writeCSV.writeRecords(products);
  console.log("📄 Saved to puma_products.csv");

  await browser.close();
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

scrapePumaCollection();
