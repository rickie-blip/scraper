// import puppeteer from "puppeteer";
// import fs from "fs";
// import path from "path";

// export async function scrapeCollection(url) {
//   const browser = await puppeteer.launch({
//     headless: true,
//     args: ["--no-sandbox", "--disable-setuid-sandbox"],
//   });

//   const page = await browser.newPage();
//   await page.setUserAgent(
//     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
//   );

//   await page.goto(url, { waitUntil: "networkidle2" });

//   // scrolling logic here...

//   const productLinks = await page.evaluate(() => {
//     return [
//       ...new Set(
//         Array.from(document.querySelectorAll("a[href*='/products/']")).map(
//           (a) => a.href.split("?")[0]
//         )
//       ),
//     ];
//   });

//   const products = [];

//   for (const link of productLinks) {
//     const jsonUrl = `${link}.js`;

//     const product = await page.evaluate(async (jsonUrl) => {
//       const res = await fetch(jsonUrl);
//       const data = await res.json();

//       const variants = data.variants || [];

//       const formatPrice = (value) =>
//         value ? value / 100 : null;

//       return {
//         title: data.title || "",
//         price: formatPrice(variants[0]?.price),
//         compareAtPrice: formatPrice(variants[0]?.compare_at_price),
//         images: data.images || [],
//         url: data.url || "",
//       };
//     }, jsonUrl);

//     product.url = link;
//     products.push(product);
//   }

//   await browser.close();

//   return products; // 🔥 RETURN instead of writing file
// }


export async function scrapeCollection(url) {
  try {
    const collectionHandle = url.split("/collections/")[1].split("/")[0];

    const products = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const apiUrl = `https://www.neviive.com/collections/${collectionHandle}/products.json?limit=250&page=${page}`;

      console.log("Fetching:", apiUrl);

      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data.products || data.products.length === 0) {
        hasMore = false;
        break;
      }

      const mapped = data.products.map((p) => {
        const firstVariant = p.variants?.[0] || {};

        return {
          title: p.title,
          price: firstVariant.price
            ? Number(firstVariant.price)
            : null,
          compareAtPrice: firstVariant.compare_at_price
            ? Number(firstVariant.compare_at_price)
            : null,
          images: p.images.map((img) => img.src),
          url: `https://www.neviive.com/products/${p.handle}`,
        };
      });

      products.push(...mapped);

      if (data.products.length < 250) {
        hasMore = false;
      }

      page++;
    }

    return products;
  } catch (error) {
    console.error("Collection scrape failed:", error);
    throw error;
  }
}