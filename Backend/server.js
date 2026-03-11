import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import { scrapeCollection } from "./scraper.js";

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
const LANGFLOW_HOST = process.env.LANGFLOW_HOST || "";
const LANGFLOW_FLOW_ID = process.env.LANGFLOW_FLOW_ID || "";
const LANGFLOW_API_KEY = process.env.LANGFLOW_API_KEY || "";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const COLLECTION_OVERRIDES_FILE = path.join(__dirname, "collection_overrides.json");
const BRAND_CURRENCY = {
  Vivo: "KES",
  Nalani: "KES",
  Neviive: "KES",
  Diracfashion: "KES",
};
const DEFAULT_COMPETITORS = [
  { name: "Vivo", website: "https://pay.shopzetu.com", currency: BRAND_CURRENCY.Vivo },
  { name: "Nalani", website: "https://nalaniwomen.com", currency: BRAND_CURRENCY.Nalani },
  { name: "Neviive", website: "https://neviive.com", currency: BRAND_CURRENCY.Neviive },
  { name: "Diracfashion", website: "https://diracfashion.com", currency: BRAND_CURRENCY.Diracfashion },
];

function resolveBrandCurrency(brand) {
  return BRAND_CURRENCY[brand] || "USD";
}

function normalizeLangflowHost(host) {
  if (!host) return "";
  return String(host).replace(/\/+$/, "");
}

async function ensureStore() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const seededCompetitors = DEFAULT_COMPETITORS.map((c, idx) => ({
      id: idx + 1,
      name: c.name,
      website: c.website,
      currency: c.currency || null,
      created_at: new Date().toISOString(),
    }));
    const initial = {
      competitors: seededCompetitors,
      products: [],
      history: [],
      counters: { competitor: seededCompetitors.length + 1, product: 1, history: 1 },
      seeded: true,
    };
    await fs.writeFile(DATA_FILE, JSON.stringify(initial, null, 2), "utf-8");
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(DATA_FILE, "utf-8");
  const store = JSON.parse(raw);
  if (
    Array.isArray(store.competitors) &&
    store.competitors.length === 0 &&
    !store.seeded
  ) {
    const seededCompetitors = DEFAULT_COMPETITORS.map((c, idx) => ({
      id: idx + 1,
      name: c.name,
      website: c.website,
      currency: c.currency || null,
      created_at: new Date().toISOString(),
    }));
    store.competitors = seededCompetitors;
    store.counters = store.counters || { competitor: 1, product: 1, history: 1 };
    store.counters.competitor = seededCompetitors.length + 1;
    store.seeded = true;
    await writeStore(store);
  }
  return store;
}

async function loadCollectionOverrides() {
  try {
    const raw = await fs.readFile(COLLECTION_OVERRIDES_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { byHost: {}, byName: {} };
  }
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

function findPriceInText(text) {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  const prefixed = cleaned.match(
    /(?:\$|USD|KES|KSh|€|£)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i
  );
  if (prefixed) return normalizeMoney(prefixed[1]);
  const suffixed = cleaned.match(
    /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(USD|KES|KSh|€|£)/i
  );
  if (suffixed) return normalizeMoney(suffixed[1]);
  return null;
}

function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractGenericProductsFromHtml(baseUrl, html, limit = 200) {
  const $ = load(html);
  const baseOrigin = new URL(baseUrl).origin;
  const seen = new Set();
  const results = [];

  const anchorNodes = $("a[href]").toArray();
  for (const node of anchorNodes) {
    if (results.length >= limit) break;
    const href = $(node).attr("href");
    if (!href || href.startsWith("#")) continue;
    const abs = absoluteUrl(baseUrl, href);
    if (!abs) continue;
    if (!abs.startsWith(baseOrigin)) continue;
    if (seen.has(abs)) continue;

    const anchorText = $(node).text().replace(/\s+/g, " ").trim();
    const container = $(node).closest("li, article, div");
    const containerText = container.text().replace(/\s+/g, " ").trim();
    const price =
      findPriceInText(containerText) ??
      findPriceInText(anchorText);

    const img = $(node).find("img").first().length
      ? $(node).find("img").first()
      : container.find("img").first();
    const image =
      img.attr("src") || img.attr("data-src") || img.attr("data-original") || null;
    const title =
      anchorText ||
      img.attr("alt") ||
      container.find("h1, h2, h3, h4, h5").first().text().trim() ||
      abs;

    const path = new URL(abs).pathname.toLowerCase();
    const likelyProduct =
      /product|products|item|shop|catalog|collection/.test(path) || price != null;
    if (!likelyProduct) continue;

    seen.add(abs);
    results.push({
      title,
      price,
      image,
      url: abs,
    });
  }

  return results;
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

async function shopifySearchProducts(website, query) {
  const parsed = new URL(website);
  const url = `${parsed.origin}/search/suggest.json?q=${encodeURIComponent(
    query
  )}&resources[type]=product`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const products = data?.resources?.results?.products || [];
  return products.map((p) => ({
    title: p.title,
    price: Number(p.price),
    image: p.image || null,
    url: p.url ? `${parsed.origin}${p.url}` : parsed.origin,
  }));
}

async function genericSearchProducts(website, query) {
  const parsed = new URL(website);
  const candidates = [
    `${parsed.origin}/search?q=${encodeURIComponent(query)}`,
    `${parsed.origin}/search?query=${encodeURIComponent(query)}`,
    `${parsed.origin}/search?keyword=${encodeURIComponent(query)}`,
    `${parsed.origin}/?s=${encodeURIComponent(query)}`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const products = extractGenericProductsFromHtml(url, html);
      if (products.length) return products;
    } catch {
      // try next
    }
  }

  try {
    const res = await fetch(parsed.origin, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    return extractGenericProductsFromHtml(parsed.origin, html);
  } catch {
    return [];
  }
}

function slugifyCollectionQuery(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function buildCollectionCandidates(website, query) {
  const origin = new URL(website).origin;
  const raw = String(query || "").toLowerCase().trim();
  if (!raw) return [];

  const baseSlug = slugifyCollectionQuery(raw);
  const candidates = new Set();
  if (baseSlug) candidates.add(baseSlug);

  const normalized = raw.replace(/\s+/g, " ");
  const tokens = normalized.split(" ");
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (last.endsWith("s")) {
      candidates.add(slugifyCollectionQuery(tokens.slice(0, -1).join(" ")));
      candidates.add(slugifyCollectionQuery(last));
    }
  }

  if (raw.includes("dress")) candidates.add("dresses");
  if (raw.includes("skirt")) candidates.add("skirts");
  if (raw.includes("top")) candidates.add("tops");
  if (raw.includes("bottom")) candidates.add("bottoms");

  return Array.from(candidates)
    .filter(Boolean)
    .map((slug) => `${origin}/collections/${slug}`);
}

function buildQueryVariants(query) {
  const base = String(query || "").trim();
  if (!base) return [];
  const variants = new Set([base]);
  const lower = base.toLowerCase();
  if (lower.endsWith("s")) variants.add(lower.slice(0, -1));
  if (lower.includes("&")) variants.add(lower.replace(/&/g, "and"));
  if (lower.includes(" and ")) variants.add(lower.replace(/ and /g, " & "));
  return Array.from(variants);
}

function buildStoredSearchResults(store, competitorId, query, fallbackCurrency) {
  const normalizedQuery = String(query || "").toLowerCase().trim();
  const candidates = store.products.filter(
    (p) => String(p.competitor_id) === String(competitorId)
  );
  const filtered = normalizedQuery
    ? candidates.filter((p) => {
        const name = String(p.product_name || "").toLowerCase();
        const category = String(p.category || "").toLowerCase();
        return name.includes(normalizedQuery) || category.includes(normalizedQuery);
      })
    : candidates;

  return filtered.map((p) => ({
    title: p.product_name,
    price: p.latest_price ?? null,
    image: p.image || null,
    url: p.product_url,
    currency: p.currency || fallbackCurrency || null,
  }));
}

function buildOverrideCandidates(website, competitorName, query, overrides) {
  const origin = new URL(website).origin;
  const host = new URL(website).host.replace(/^www\./, "");
  const normalizedQuery = String(query || "").toLowerCase().trim();

  const byHost = overrides?.byHost?.[host] || {};
  const byName = overrides?.byName?.[competitorName] || {};
  const handles =
    byHost[normalizedQuery] ||
    byName[normalizedQuery] ||
    byHost[query] ||
    byName[query] ||
    [];

  return Array.isArray(handles)
    ? handles.map((handle) => `${origin}/collections/${handle}`)
    : [];
}

function expandCollectionCandidates(candidates) {
  const expanded = new Set(candidates);
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      const host = parsed.host;
      if (!host.startsWith("www.")) {
        parsed.host = `www.${host}`;
        expanded.add(parsed.toString());
      }
    } catch {
      // ignore invalid
    }
  }
  return Array.from(expanded);
}

async function scrapeCollectionHtml(url) {
  const html = await fetchText(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  return extractGenericProductsFromHtml(url, html);
}

async function findShopifyCollections(website, query) {
  const origin = new URL(website).origin;
  const normalizedQuery = String(query || "").toLowerCase().trim();
  if (!normalizedQuery) return [];

  const queryTokens = normalizedQuery
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  const matches = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 5) {
    const apiUrl = `${origin}/collections.json?limit=250&page=${page}`;
    try {
      const data = await fetchJson(apiUrl);
      const collections = data?.collections || [];
      if (!collections.length) break;

      for (const collection of collections) {
        const title = String(collection.title || "").toLowerCase();
        const handle = collection.handle;
        if (!handle) continue;
        const titleTokens = title
          .replace(/&/g, "and")
          .replace(/[^a-z0-9\s-]/g, "")
          .split(/\s+/)
          .filter(Boolean);
        const isMatch = queryTokens.every((token) => titleTokens.includes(token));
        const looseMatch =
          !queryTokens.length ||
          title.includes(normalizedQuery) ||
          (normalizedQuery.includes("dress") && title.includes("dress")) ||
          (normalizedQuery.includes("skirt") && title.includes("skirt")) ||
          (normalizedQuery.includes("top") && title.includes("top")) ||
          (normalizedQuery.includes("bottom") && title.includes("bottom"));
        if (isMatch || looseMatch) {
          matches.push(`${origin}/collections/${handle}`);
        }
      }

      if (collections.length < 250) {
        hasMore = false;
      } else {
        page += 1;
      }
    } catch {
      break;
    }
  }

  return Array.from(new Set(matches));
}

async function scrapeShopifyCollection(url, currency) {
  const parsed = new URL(url);
  const collectionHandle = parsed.pathname.split("/collections/")[1]?.split("/")[0];
  if (!collectionHandle) {
    throw new Error("Invalid Shopify collection URL.");
  }

  const products = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const apiUrl = `${parsed.origin}/collections/${collectionHandle}/products.json?limit=250&page=${page}`;
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
    });
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
        price: firstVariant.price ? Number(firstVariant.price) : null,
        compareAtPrice: firstVariant.compare_at_price
          ? Number(firstVariant.compare_at_price)
          : null,
        images: p.images.map((img) => img.src),
        url: `${parsed.origin}/products/${p.handle}`,
        currency: currency || null,
      };
    });

    products.push(...mapped);
    if (data.products.length < 250) {
      hasMore = false;
    }
    page++;
  }

  return products;
}


app.get("/", (req, res) => {
  res.send("Welcome to the Web Scraper API!");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/api/langflow/run", async (req, res) => {
  try {
    const {
      message,
      sessionId,
      inputType,
      outputType,
      tweaks,
      flowId,
      hostUrl,
      apiKey,
    } = req.body || {};

    if (!message) {
      return res.status(400).json({ error: "message is required." });
    }

    const resolvedHost = normalizeLangflowHost(hostUrl || LANGFLOW_HOST);
    const resolvedFlowId = flowId || LANGFLOW_FLOW_ID;
    const resolvedApiKey = apiKey || LANGFLOW_API_KEY;

    if (!resolvedHost || !resolvedFlowId) {
      return res.status(400).json({
        error: "Langflow host and flow ID are required.",
      });
    }

    const payload = {
      input_value: message,
      input_type: inputType || "chat",
      output_type: outputType || "chat",
    };

    if (sessionId) payload.session_id = sessionId;
    if (tweaks) payload.tweaks = tweaks;

    const response = await fetch(
      `${resolvedHost}/api/v1/run/${resolvedFlowId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          ...(resolvedApiKey ? { "x-api-key": resolvedApiKey } : {}),
        },
        body: JSON.stringify(payload),
      }
    );

    const raw = await response.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Langflow request failed.",
        status: response.status,
        data,
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
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
    const { name, website, currency } = req.body || {};
    if (!name || !website) {
      return res.status(400).json({ error: "Name and website are required." });
    }

    const store = await readStore();
    const competitor = {
      id: store.counters.competitor++,
      name: String(name),
      website: String(website),
      currency: currency ? String(currency).toUpperCase() : null,
      created_at: new Date().toISOString(),
    };
    store.competitors.push(competitor);
    await writeStore(store);
    res.status(201).json(competitor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/competitors/:id", async (req, res) => {
  try {
    const { name, website, currency } = req.body || {};
    if (!name || !website) {
      return res.status(400).json({ error: "Name and website are required." });
    }

    const store = await readStore();
    const competitor = store.competitors.find(
      (c) => String(c.id) === String(req.params.id)
    );
    if (!competitor) {
      return res.status(404).json({ error: "Competitor not found." });
    }

    competitor.name = String(name);
    competitor.website = String(website);
    competitor.currency = currency ? String(currency).toUpperCase() : null;
    competitor.updated_at = new Date().toISOString();

    for (const product of store.products) {
      if (String(product.competitor_id) === String(competitor.id)) {
        product.competitor_name = competitor.name;
      }
    }

    await writeStore(store);
    res.status(200).json(competitor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/competitors/:id", async (req, res) => {
  try {
    const store = await readStore();
    const competitorIndex = store.competitors.findIndex(
      (c) => String(c.id) === String(req.params.id)
    );
    if (competitorIndex === -1) {
      return res.status(404).json({ error: "Competitor not found." });
    }

    const competitor = store.competitors[competitorIndex];
    store.competitors.splice(competitorIndex, 1);

    const removedProductIds = store.products
      .filter((product) => String(product.competitor_id) === String(competitor.id))
      .map((product) => product.id);
    store.products = store.products.filter(
      (product) => String(product.competitor_id) !== String(competitor.id)
    );

    const beforeHistory = store.history.length;
    store.history = store.history.filter(
      (entry) => !removedProductIds.includes(entry.product_id)
    );
    const removedHistoryCount = beforeHistory - store.history.length;

    await writeStore(store);
    res.status(200).json({
      ok: true,
      competitor,
      removed_products: removedProductIds.length,
      removed_history: removedHistoryCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/competitors/:id/search", async (req, res) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).json({ error: "Query is required." });
    }

    const store = await readStore();
    const competitor = store.competitors.find(
      (c) => String(c.id) === String(req.params.id)
    );
    if (!competitor) {
      return res.status(404).json({ error: "Competitor not found." });
    }

    let products = [];
    const overrides = await loadCollectionOverrides();
    const overrideCandidates = expandCollectionCandidates(
      buildOverrideCandidates(competitor.website, competitor.name, query, overrides)
    );
    for (const candidate of overrideCandidates) {
      try {
        products = await scrapeShopifyCollection(candidate, competitor.currency);
        if (products.length) break;
      } catch {
        // try next candidate
      }
    }

    if (!products.length) {
      for (const candidate of overrideCandidates) {
        try {
          products = await scrapeCollectionHtml(candidate);
          if (products.length) break;
        } catch {
          // try next candidate
        }
      }
    }

    const collectionCandidates = expandCollectionCandidates(
      buildCollectionCandidates(competitor.website, query)
    );
    for (const candidate of collectionCandidates) {
      try {
        products = await scrapeShopifyCollection(candidate, competitor.currency);
        if (products.length) break;
      } catch {
        // try next candidate
      }
    }

    if (!products.length) {
      for (const candidate of collectionCandidates) {
        try {
          products = await scrapeCollectionHtml(candidate);
          if (products.length) break;
        } catch {
          // try next candidate
        }
      }
    }

    if (!products.length) {
      const discoveredCollections = await findShopifyCollections(competitor.website, query);
      const discoveredCandidates = expandCollectionCandidates(discoveredCollections);
      for (const candidate of discoveredCandidates) {
        try {
          products = await scrapeShopifyCollection(candidate, competitor.currency);
          if (products.length) break;
        } catch {
          // try next candidate
        }
      }
    }

    if (!products.length) {
      const discoveredCollections = await findShopifyCollections(competitor.website, query);
      const discoveredCandidates = expandCollectionCandidates(discoveredCollections);
      for (const candidate of discoveredCandidates) {
        try {
          products = await scrapeCollectionHtml(candidate);
          if (products.length) break;
        } catch {
          // try next candidate
        }
      }
    }

    if (!products.length) {
      const queryVariants = buildQueryVariants(query);
      for (const variant of queryVariants) {
        try {
          products = await shopifySearchProducts(competitor.website, variant);
          if (!products.length) {
            products = await genericSearchProducts(competitor.website, variant);
          }
        } catch {
          products = await genericSearchProducts(competitor.website, variant);
        }
        if (products.length) break;
      }
    }

    if (!products.length) {
      products = buildStoredSearchResults(
        store,
        competitor.id,
        query,
        competitor.currency
      );
    }
    const currency = competitor.currency || "USD";
    const data = products.map((p) => ({
      ...p,
      brand: competitor.name,
      currency,
    }));

    let persisted = { created: 0, updated: 0, history: 0 };
    const persistFlag = String(req.query.persist || "").toLowerCase();
    const shouldPersist = persistFlag === "1" || persistFlag === "true" || persistFlag === "yes";

    if (shouldPersist) {
      const collectedAt = new Date().toISOString();
      const collectedDay = collectedAt.slice(0, 10);
      for (const item of data) {
        const productUrl = item.url || item.product_url || "";
        if (!productUrl) continue;
        let product = store.products.find(
          (p) =>
            String(p.competitor_id) === String(competitor.id) &&
            String(p.product_url) === String(productUrl)
        );
        if (!product) {
          product = {
            id: store.counters.product++,
            competitor_id: Number(competitor.id),
            competitor_name: competitor.name,
            product_name: String(item.title || item.product_name || "Unknown"),
            category: String(query || "General"),
            product_url: String(productUrl),
            currency: item.currency || competitor.currency || null,
            latest_price: null,
            latest_collected_at: null,
          };
          store.products.push(product);
          persisted.created += 1;
        } else {
          product.product_name = item.title || item.product_name || product.product_name;
          product.currency = item.currency || product.currency || competitor.currency || null;
          persisted.updated += 1;
        }

        const priceValue = Number(item.price);
        if (Number.isFinite(priceValue)) {
          const normalizedPrice = Number(priceValue.toFixed(2));
          const alreadyLogged =
            store.history.some(
              (h) =>
                h.product_id === product.id &&
                Number(h.price).toFixed(2) === normalizedPrice.toFixed(2) &&
                String(h.collected_at || "").slice(0, 10) === collectedDay
            ) ||
            (Number(product.latest_price).toFixed(2) === normalizedPrice.toFixed(2) &&
              String(product.latest_collected_at || "").slice(0, 10) === collectedDay);

          if (!alreadyLogged) {
            const entry = {
              id: store.counters.history++,
              product_id: product.id,
              price: normalizedPrice,
              collected_at: collectedAt,
            };
            store.history.push(entry);
            product.latest_price = entry.price;
            product.latest_collected_at = entry.collected_at;
            persisted.history += 1;
          }
        }
      }

      await writeStore(store);
    }

    res.status(200).json({
      success: true,
      count: data.length,
      data,
      competitor: { id: competitor.id, name: competitor.name },
      persisted,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/competitors/:id/presets", async (req, res) => {
  try {
    const store = await readStore();
    const competitor = store.competitors.find(
      (c) => String(c.id) === String(req.params.id)
    );
    if (!competitor) {
      return res.status(404).json({ error: "Competitor not found." });
    }

    const defaults = [
      "dresses",
      "bodycons",
      "corset dresses",
      "knee length dresses",
      "midi & capri dresses",
      "maxi dresses",
      "short dresses",
      "mini dresses",
      "shirt dresses",
      "skirts",
      "denim skirts",
      "knee length skirts",
      "midi & capri skirts",
      "mini skirts",
      "maxi skirts",
      "skirt suits",
      "bottoms",
      "culottes & capri pants",
      "denim bottoms",
      "full length pants",
      "jumpsuits & playsuits",
      "leggings",
      "loungewear",
      "midi & capri pants",
      "pant sets",
      "short sets",
      "shorts & skorts",
      "tops",
      "beachwear",
      "bodysuits",
      "corset tops",
      "crop shirts",
      "fitted tops",
      "midriff & crop tops",
      "loose tops",
      "shirt tops",
      "t-shirts & tank tops",
      "innerwear",
      "bra & panty sets",
      "bralettes",
      "bras",
      "lingerie",
      "panties",
      "shapewear",
    ];
    const presets = Array.isArray(competitor.search_presets) && competitor.search_presets.length
      ? competitor.search_presets
      : defaults;

    res.status(200).json({
      competitor: { id: competitor.id, name: competitor.name },
      presets,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/collections/scrape", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ error: "Collection URL is required." });
    }
    const currency = req.query.currency
      ? String(req.query.currency).toUpperCase()
      : null;
    let products = [];
    try {
      products = await scrapeShopifyCollection(url, currency);
    } catch {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: `HTTP ${response.status}` });
      }
      const html = await response.text();
      products = extractGenericProductsFromHtml(url, html);
    }
    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const store = await readStore();
    const products = store.products.map((product) => {
      const competitor = store.competitors.find(
        (c) => String(c.id) === String(product.competitor_id)
      );
      return {
        ...product,
        competitor_currency: competitor?.currency || null,
      };
    });
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const { competitor_id, product_name, category, product_url, currency } = req.body || {};
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
      currency: currency ? String(currency).toUpperCase() : competitor.currency || null,
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
    const competitor = store.competitors.find(
      (c) => String(c.id) === String(product.competitor_id)
    );

    const points = store.history
      .filter((h) => h.product_id === id)
      .sort((a, b) => new Date(a.collected_at) - new Date(b.collected_at));

    res.status(200).json({
      product: {
        ...product,
        competitor_currency: competitor?.currency || null,
      },
      points,
    });
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

    const brand = "Vivo";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://shopzetu.com" + p.url,
        brand,
        currency,
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

    const brand = "Nalani";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://nalaniwomen.com" + p.url,
        brand,
        currency,
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

    const brand = "Neviive";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://neviive.com" + p.url,
        brand,
        currency,
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

    const brand = "Diracfashion";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://diracfashion.com" + p.url,
        brand,
        currency,
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

    const brand = "Vivo";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://shopzetu.com" + p.url,
        brand,
        currency,
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

    const brand = "Nalani";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://nalaniwomen.com" + p.url,
        brand,
        currency,
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

    const brand = "Neviive";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://neviive.com" + p.url,
        brand,
        currency,
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

    const brand = "Diracfashion";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://diracfashion.com" + p.url,
        brand,
        currency,
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

    const brand = "Vivo";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://shopzetu.com" + p.url,
        brand,
        currency,
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

    const brand = "Nalani";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://nalaniwomen.com" + p.url,
        brand,
        currency,
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

    const brand = "Neviive";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://neviive.com" + p.url,
        brand,
        currency,
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

    const brand = "Diracfashion";
    const currency = resolveBrandCurrency(brand);
    const products =
      data.resources?.results?.products?.map((p) => ({
        title: p.title,
        price: Number(p.price), // convert cents to base currency
        image: p.image,
        url: "https://diracfashion.com" + p.url,
        brand,
        currency,
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
          currency: "KES",
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
          currency: "KES",
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
    const enriched = products.map((p) => ({ ...p, currency: "KES" }));

    res.status(200).json({
      success: true,
      count: enriched.length,
      data: enriched,
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
    const enriched = products.map((p) => ({ ...p, currency: "KES" }));

    res.status(200).json({
      success: true,
      count: enriched.length,
      data: enriched,
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
