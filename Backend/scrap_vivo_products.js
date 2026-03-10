import fetch from "node-fetch";

async function testShopzetuJSON() {
  try {
    const url =
      "https://pay.shopzetu.com/search/suggest.json?q=bodycon&resources[type]=product";

    console.log(`Fetching: ${url}\n`);

    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price),
        image: p.image,
        url: "https://pay.shopzetu.com" + p.url,
      })) || [];

    console.log(`\n✅ Found ${products.length} products\n`);
    console.log(products.slice(0, 5));
  } catch (err) {
    console.error("❌ Failed:", err.message);
  }
}

testShopzetuJSON();