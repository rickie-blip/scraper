export async function scrapeCollection(collectionUrl) {
  const parsed = new URL(collectionUrl);

  const base = parsed.origin;
  const collectionHandle = parsed.pathname.split("/collections/")[1];

  if (!collectionHandle) {
    throw new Error("Invalid Shopify collection URL");
  }

  let page = 1;
  let hasMore = true;

  const products = [];

  while (hasMore) {
    const apiUrl = `${base}/collections/${collectionHandle}/products.json?limit=250&page=${page}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.products || data.products.length === 0) break;

    const mapped = data.products.map((p) => {
      const firstVariant = p.variants?.[0] || {};

      return {
        title: p.title,
        price: firstVariant.price ? Number(firstVariant.price) : null,
        compareAtPrice: firstVariant.compare_at_price
          ? Number(firstVariant.compare_at_price)
          : null,
        images: p.images.map((img) => img.src),
        url: `${base}/products/${p.handle}`,
      };
    });

    products.push(...mapped);

    if (data.products.length < 250) hasMore = false;

    page++;
  }

  return products;
}