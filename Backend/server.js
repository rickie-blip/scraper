import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import { scrapeCollection } from "./scrap_collection_json.js";

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 5000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

async function ensureStore() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const initial = {
      competitors: [],
      products: [],
      history: [],
      counters: { competitor: 1, product: 1, history: 1 },
    };
    await fs.writeFile(DATA_FILE, JSON.stringify(initial, null, 2), "utf-8");
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

async function writeStore(store) {
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function toNumber(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function normalizeMoney(raw) {
  const num = toNumber(raw);
  if (num == null) return null;
  if (Number.isInteger(num) && num >= 1000) return Number((num / 100).toFixed(2));
  return Number(num.toFixed(2));
}

async function fetchShopifyPrice(productUrl) {
  try {
    const parsed = new URL(productUrl);
    if (!parsed.pathname.includes("/products/")) return null;
    const basePath = parsed.pathname.split("?")[0];
    const jsonUrl = `${parsed.origin}${basePath}.json`;
    const res = await fetch(jsonUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.product?.variants?.[0]?.price;
    return normalizeMoney(price);
  } catch {
    return null;
  }
}

async function scrapePriceFromHtml(productUrl) {
  const res = await fetch(productUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = load(html);

  const metaPrice =
    $('meta[property="product:price:amount"]').attr("content") ||
    $('meta[itemprop="price"]').attr("content");
  if (metaPrice) return normalizeMoney(metaPrice);

  const candidates = [
    "[itemprop=price]",
    ".price",
    ".product-price",
    ".price-item--regular",
    ".money",
    "[data-price]",
  ];

  for (const selector of candidates) {
    const text = $(selector).first().text();
    const parsed = normalizeMoney(text);
    if (parsed != null) return parsed;
  }

  return null;
}

async function resolveProductPrice(productUrl) {
  const shopifyPrice = await fetchShopifyPrice(productUrl);
  if (shopifyPrice != null) return shopifyPrice;
  return await scrapePriceFromHtml(productUrl);
}

function buildSummary(store) {
  const latestUpdates = [...store.history]
    .sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at))
    .slice(0, 8)
    .map((entry) => {
      const product = store.products.find((p) => p.id === entry.product_id);
      return {
        product_id: entry.product_id,
        product_name: product?.product_name || "Unknown",
        price: entry.price,
        collected_at: entry.collected_at,
      };
    });

  return {
    total_competitors: store.competitors.length,
    total_products: store.products.length,
    latest_updates: latestUpdates,
  };
}

function buildComparison(store, baseCompetitor, category) {
  const rows = [];
  const grouped = new Map();

  for (const product of store.products) {
    if (category && product.category !== category) continue;
    if (product.latest_price == null) continue;
    const key = product.competitor_name;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(product.latest_price);
  }

  let baseAvg = null;
  if (baseCompetitor && grouped.has(baseCompetitor)) {
    const prices = grouped.get(baseCompetitor);
    baseAvg = prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  for (const [competitor, prices] of grouped.entries()) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const delta = baseAvg != null ? avg - baseAvg : null;
    const deltaPct = baseAvg ? (delta / baseAvg) * 100 : null;
    rows.push({
      competitor,
      items_count: prices.length,
      avg_price: Number(avg.toFixed(2)),
      delta_vs_vivo: delta != null ? Number(delta.toFixed(2)) : null,
      delta_pct_vs_vivo: deltaPct != null ? Number(deltaPct.toFixed(2)) : null,
    });
  }

  rows.sort((a, b) => a.competitor.localeCompare(b.competitor));
  return { base_found: baseAvg != null, rows };
}

async function shopifySuggest(website, query) {
  const parsed = new URL(website);
  const url = `${parsed.origin}/search/suggest.json?q=${encodeURIComponent(
    query
  )}&resources[type]=product`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const product = data?.resources?.results?.products?.[0];
  if (!product) return null;
  return {
    product_name: product.title,
    price: normalizeMoney(product.price),
    product_url: product.url ? `${parsed.origin}${product.url}` : website,
  };
}


app.get("/", (req, res) => {
  res.send("Welcome to the Web Scraper API!");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/dashboard/summary", async (req, res) => {
  try {
    const store = await readStore();
    res.status(200).json(buildSummary(store));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/competitors", async (req, res) => {
  try {
    const store = await readStore();
    res.status(200).json(store.competitors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/competitors", async (req, res) => {
  try {
    const { name, website } = req.body || {};
    if (!name || !website) {
      return res.status(400).json({ error: "Name and website are required." });
    }

    const store = await readStore();
    const competitor = {
      id: store.counters.competitor++,
      name: String(name),
      website: String(website),
      created_at: new Date().toISOString(),
    };
    store.competitors.push(competitor);
    await writeStore(store);
    res.status(201).json(competitor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const store = await readStore();
    res.status(200).json(store.products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const { competitor_id, product_name, category, product_url } = req.body || {};
    if (!competitor_id || !product_name || !product_url) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const store = await readStore();
    const competitor = store.competitors.find(
      (c) => String(c.id) === String(competitor_id)
    );
    if (!competitor) {
      return res.status(400).json({ error: "Competitor not found." });
    }

    const product = {
      id: store.counters.product++,
      competitor_id: Number(competitor_id),
      competitor_name: competitor.name,
      product_name: String(product_name),
      category: category || "General",
      product_url: String(product_url),
      latest_price: null,
      latest_collected_at: null,
    };
    store.products.push(product);
    await writeStore(store);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/products/:id/history", async (req, res) => {
  try {
    const store = await readStore();
    const id = Number(req.params.id);
    const product = store.products.find((p) => p.id === id);
    if (!product) {
      return res.status(404).json({ error: "Product not found." });
    }

    const points = store.history
      .filter((h) => h.product_id === id)
      .sort((a, b) => new Date(a.collected_at) - new Date(b.collected_at));

    res.status(200).json({ product, points });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/products/:id/scrape", async (req, res) => {
  try {
    const store = await readStore();
    const id = Number(req.params.id);
    const product = store.products.find((p) => p.id === id);
    if (!product) {
      return res.status(404).json({ error: "Product not found." });
    }

    const price = await resolveProductPrice(product.product_url);
    if (price == null) {
      return res.status(400).json({ error: "Price not found." });
    }

    const entry = {
      id: store.counters.history++,
      product_id: id,
      price,
      collected_at: new Date().toISOString(),
    };
    store.history.push(entry);
    product.latest_price = price;
    product.latest_collected_at = entry.collected_at;
    await writeStore(store);
    res.status(200).json({ ok: true, entry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/scrape/run", async (req, res) => {
  try {
    const store = await readStore();
    const results = [];

    for (const product of store.products) {
      try {
        const price = await resolveProductPrice(product.product_url);
        if (price == null) {
          results.push({ product_id: product.id, ok: false, error: "Price not found." });
          continue;
        }
        const entry = {
          id: store.counters.history++,
          product_id: product.id,
          price,
          collected_at: new Date().toISOString(),
        };
        store.history.push(entry);
        product.latest_price = price;
        product.latest_collected_at = entry.collected_at;
        results.push({ product_id: product.id, ok: true, price });
      } catch (err) {
        results.push({ product_id: product.id, ok: false, error: err.message });
      }
    }

    await writeStore(store);
    res.status(200).json({ ok: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/comparison", async (req, res) => {
  try {
    const store = await readStore();
    const base = req.query.base_competitor || "";
    const category = req.query.category || "";
    const result = buildComparison(store, base, category);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/live-compare", async (req, res) => {
  try {
    const { product_name, base_competitor } = req.body || {};
    if (!product_name || !base_competitor) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const store = await readStore();
    const matches = [];
    const failed = [];
    let baseFound = false;
    let basePrice = null;

    for (const competitor of store.competitors) {
      try {
        const result = await shopifySuggest(competitor.website, product_name);
        if (!result) {
          failed.push({ competitor: competitor.name, error: "No match" });
          continue;
        }

        if (competitor.name === base_competitor) {
          baseFound = true;
          basePrice = result.price;
        }

        matches.push({
          competitor: competitor.name,
          product_name: result.product_name,
          price: result.price,
          delta_vs_vivo: null,
          delta_pct_vs_vivo: null,
          product_url: result.product_url,
        });
      } catch (err) {
        failed.push({ competitor: competitor.name, error: err.message });
      }
    }

    if (baseFound && basePrice != null) {
      for (const row of matches) {
        if (row.price == null) continue;
        const delta = row.price - basePrice;
        row.delta_vs_vivo = Number(delta.toFixed(2));
        row.delta_pct_vs_vivo =
          basePrice !== 0 ? Number(((delta / basePrice) * 100).toFixed(2)) : null;
      }
    }

    res.status(200).json({
      base_found: baseFound,
      matches,
      failed,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// no puppeteer, just fetch 
app.get("/search-vivo-bodycons", async (req, res) => {
  try {
    const query = req.query.q || "bodycons";

    // Shopzetu Shopify JSON search endpoint
    const url = `https://pay.shopzetu.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://shopzetu.com" + p.url,
        brand: "Vivo",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});

// no puppeteer, just fetch 
app.get("/search-nalani-bodycons", async (req, res) => {
  try {
    const query = req.query.q || "bodycons";

    // Shopify JSON search endpoint
    const url = `https://nalaniwomen.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://nalaniwomen.com" + p.url,
        brand: "Nalani",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});

// no puppeteer, just fetch 
app.get("/search-neviive-bodycons", async (req, res) => {
  try {
    const query = req.query.q || "bodycons";

    // Shopify JSON search endpoint
    const url = `https://neviive.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://neviive.com" + p.url,
        brand: "Neviive",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});


// no puppeteer, just fetch 
app.get("/search-dirac-bodycons", async (req, res) => {
  try {
    const query = req.query.q || "bodycons";

    // Shopify JSON search endpoint
    const url = `https://diracfashion.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://diracfashion.com" + p.url,
        brand: "Diracfashion",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});


// no puppeteer, just fetch 
app.get("/search-vivo-bodysuits", async (req, res) => {
  try {
    const query = req.query.q || "bodysuits";

    // Shopzetu Shopify JSON search endpoint
    const url = `https://pay.shopzetu.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://shopzetu.com" + p.url,
        brand: "Vivo",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});

// no puppeteer, just fetch 
app.get("/search-nalani-bodysuits", async (req, res) => {
  try {
    const query = req.query.q || "bodysuits";

    // Shopify JSON search endpoint
    const url = `https://nalaniwomen.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://nalaniwomen.com" + p.url,
        brand: "Nalani",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});

// no puppeteer, just fetch 
app.get("/search-neviive-bodysuits", async (req, res) => {
  try {
    const query = req.query.q || "bodysuits";

    // Shopify JSON search endpoint
    const url = `https://neviive.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://neviive.com" + p.url,
        brand: "Neviive",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});


// no puppeteer, just fetch 
app.get("/search-dirac-bodysuits", async (req, res) => {
  try {
    const query = req.query.q || "bodysuits";

    // Shopify JSON search endpoint
    const url = `https://diracfashion.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://diracfashion.com" + p.url,
        brand: "Diracfashion",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});



// no puppeteer, just fetch 
app.get("/search-vivo-dresses", async (req, res) => {
  try {
    const query = req.query.q || "dresses";

    // Shopzetu Shopify JSON search endpoint
    const url = `https://pay.shopzetu.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://shopzetu.com" + p.url,
        brand: "Vivo",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});

// no puppeteer, just fetch 
app.get("/search-nalani-dresses", async (req, res) => {
  try {
    const query = req.query.q || "dresses";

    // Shopify JSON search endpoint
    const url = `https://nalaniwomen.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://nalaniwomen.com" + p.url,
        brand: "Nalani",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});

// no puppeteer, just fetch 
app.get("/search-neviive-dresses", async (req, res) => {
  try {
    const query = req.query.q || "dresses";

    // Shopify JSON search endpoint
    const url = `https://neviive.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://neviive.com" + p.url,
        brand: "Neviive",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});

// no puppeteer, just fetch 
app.get("/search-dirac-dresses", async (req, res) => {
  try {
    const query = req.query.q || "dresses";

    // Shopify JSON search endpoint
    const url = `https://diracfashion.com/search/suggest.json?q=${encodeURIComponent(
      query
    )}&resources[type]=product`;

    console.log(`Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://diracfashion.com" + p.url,
        brand: "Diracfashion",
      })) || [];

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});


// uses puppeteer
// app.get("/puppeteer-nalani-bodycons", async (req, res) => {
//   try {
//     const url =
//       req.query.url ||
//       "https://nalaniwomen.com/search?q=bodycons&options%5Bprefix%5D=last";

//     const products = await scrapeCollection(url);

//     res.status(200).json({
//       success: true,
//       count: products.length,
//       data: products,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: "Scraping failed",
//       error: error.message,
//     });
//   }
// });

// // uses puppeteer
// app.get("/puppeteer-dresses-collection", async (req, res) => {
//   try {
//     const url =
//       req.query.url ||
//       "https://nalaniwomen.com/collections/dresses";

//     const products = await scrapeCollection(url);

//     res.status(200).json({
//       success: true,
//       count: products.length,
//       data: products,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: "Scraping failed",
//       error: error.message,
//     });
//   }
// });


app.get("/scrape-vivo-dresses-collection", async (req, res) => {
  try {
    const url =
      req.query.url ||
      "https://pay.shopzetu.com/collections/dresses";

    const parsed = new URL(url);
    const base = parsed.origin;
    const collectionHandle = parsed.pathname.split("/collections/")[1];

    if (!collectionHandle) {
      return res.status(400).json({
        success: false,
        message: "Invalid Shopify collection URL",
      });
    }

    let page = 1;
    let hasMore = true;
    const products = [];

    while (hasMore) {
      const apiUrl = `${base}/collections/${collectionHandle}/products.json?limit=250&page=${page}`;

      console.log("Fetching:", apiUrl);

      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data.products || data.products.length === 0) {
        break;
      }

      for (const p of data.products) {
        const firstVariant = p.variants?.[0] || {};

        products.push({
          title: p.title,
          price: firstVariant.price ? Number(firstVariant.price) : null,
          compareAtPrice: firstVariant.compare_at_price
            ? Number(firstVariant.compare_at_price)
            : null,
          images: p.images.map((img) => img.src),
          url: `${base}/products/${p.handle}`,
        });
      }

      if (data.products.length < 250) {
        hasMore = false;
      }

      page++;
    }

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});



app.get("/scrape-neviive-dresses-collection", async (req, res) => {
  try {
    const url =
      req.query.url ||
      "https://www.neviive.com/collections/dresses";

    const parsed = new URL(url);
    const base = parsed.origin;
    const collectionHandle = parsed.pathname.split("/collections/")[1];

    if (!collectionHandle) {
      return res.status(400).json({
        success: false,
        message: "Invalid Shopify collection URL",
      });
    }

    let page = 1;
    let hasMore = true;
    const products = [];

    while (hasMore) {
      const apiUrl = `${base}/collections/${collectionHandle}/products.json?limit=250&page=${page}`;

      console.log("Fetching:", apiUrl);

      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data.products || data.products.length === 0) {
        break;
      }

      for (const p of data.products) {
        const firstVariant = p.variants?.[0] || {};

        products.push({
          title: p.title,
          price: firstVariant.price ? Number(firstVariant.price) : null,
          compareAtPrice: firstVariant.compare_at_price
            ? Number(firstVariant.compare_at_price)
            : null,
          images: p.images.map((img) => img.src),
          url: `${base}/products/${p.handle}`,
        });
      }

      if (data.products.length < 250) {
        hasMore = false;
      }

      page++;
    }

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});

app.get("/ikojn-dresses", async (req, res) => {
  try {
    const url =
      req.query.url ||
      "https://www.ikojn.com/collections/dresses";

    const products = await scrapeCollection(url);

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});

app.get("/nalani-dresses-collection", async (req, res) => {
  try {
    const url =
      req.query.url ||
      "https://nalaniwomen.com/collections/dresses";

    const products = await scrapeCollection(url);

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Scraping failed",
      error: error.message,
    });
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on localhost:${PORT}`);
});


export default app;
