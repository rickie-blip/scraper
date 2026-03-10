import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://nalaniwomen.com";
const QUERY = "bodycons";

async function testSearchScrape() {
  try {
    const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(
      QUERY
    )}&options%5Bprefix%5D=last`;


    console.log(`Fetching: ${searchUrl}\n`);

    const response = await fetch(searchUrl);

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const html = await response.text();

    const $ = cheerio.load(html);

  const products = [];

$(".card, .grid__item").each((_, el) => {
  const title = $(el)
    .find(".card__heading, h3")
    .first()
    .text()
    .trim();

  const link = $(el)
    .find("a[href*='/products/']")
    .attr("href");

  const priceText = $(el)
    .find(".price-item, .price")
    .first()
    .text()
    .replace(/[^\d]/g, "");

  const image =
    $(el).find("img").attr("src") ||
    $(el).find("img").attr("data-src");

  if (title && link) {
    products.push({
      title,
      price: priceText ? Number(priceText)/100000 : null,
      image: image?.startsWith("//")
        ? "https:" + image
        : image,
      url: link.startsWith("http")
        ? link
        : BASE_URL + link,
    });
  }
});

    // Remove duplicates
    const uniqueProducts = [
      ...new Map(products.map((p) => [p.url, p])).values(),
    ];

    console.log(`\n✅ Found ${uniqueProducts.length} products\n`);
    console.log(uniqueProducts.slice(0, 5)); // show first 5

  } catch (error) {
    console.error("❌ Scrape failed:");
    console.error(error.message);
  }
}

testSearchScrape();