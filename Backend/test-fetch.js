import fetch from "node-fetch";

const BASE_URL = "https://nalaniwomen.com";
const COLLECTION = "bodycons"; // change to test others

async function testFetch() {
  try {
    // const url = `${BASE_URL}/collections/${COLLECTION}/products.json`;
    const url = "https://nalaniwomen.com/search?q=bodycons&options%5Bprefix%5D=last"

    console.log(`Fetching: ${url}\n`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();

    const products = (data.products || []).map((product) => ({
      title: product.title,
      vendor: product.vendor,
      price: product.variants?.[0]?.price,
      compareAtPrice: product.variants?.[0]?.compare_at_price,
      image: product.images?.[0]?.src,
      handle: product.handle,
    }));

    console.log(`✅ Found ${products.length} products\n`);

    console.log(products.slice(0, 5)); // show first 5

  } catch (error) {
    console.error("❌ Fetch failed:");
    console.error(error.message);
  }
}

testFetch();