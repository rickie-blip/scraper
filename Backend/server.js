import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import dotenv from "dotenv";
import { Pool } from "pg";
import { scrapeCollection } from "./scraper.js";

dotenv.config();

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
const DATABASE_URL = process.env.DATABASE_URL || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? path.join("/tmp", "c-analyze-data") : path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const COLLECTION_OVERRIDES_FILE = path.join(__dirname, "collection_overrides.json");
const BRAND_CURRENCY = {
  Vivo: "KES",
  Nalani: "KES",
  Neviive: "KES",
  Diracfashion: "USD",
  Leorana: "KES",
  ikojn: "KES",
};
const HOST_CURRENCY_OVERRIDES = {
};
const DEFAULT_COMPETITORS = [
  {
    name: "Vivo",
    website: "https://pay.shopzetu.com",
    currency: BRAND_CURRENCY.Vivo,
    website_aliases: ["https://pay.shopzetu.com/", "https://www.shopzetu.com/"],
  },
  { name: "Nalani", website: "https://nalaniwomen.com", currency: BRAND_CURRENCY.Nalani },
  { name: "Neviive", website: "https://neviive.com", currency: BRAND_CURRENCY.Neviive },
  { name: "Diracfashion", website: "https://diracfashion.com", currency: BRAND_CURRENCY.Diracfashion },
  { name: "Leorana", website: "https://leorana.com/", currency: BRAND_CURRENCY.Leorana },
  { name: "ikojn", website: "https://www.ikojn.com/", currency: BRAND_CURRENCY.ikojn },
];

const USE_DB = Boolean(DATABASE_URL);
let dbPool = null;

function getDbPool() {
  if (!USE_DB) return null;
  if (!dbPool) {
    dbPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.VERCEL ? { rejectUnauthorized: false } : undefined,
    });
  }
  return dbPool;
}

async function ensureDbSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      website TEXT NOT NULL,
      currency TEXT,
      website_aliases JSONB,
      search_presets JSONB,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      competitor_id INTEGER REFERENCES competitors(id) ON DELETE CASCADE,
      competitor_name TEXT,
      product_name TEXT,
      category TEXT,
      product_url TEXT,
      image TEXT,
      currency TEXT,
      latest_price NUMERIC,
      latest_collected_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY,
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      price NUMERIC,
      collected_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counters (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );
  `);
}

async function hasAnyRows(pool, table) {
  const res = await pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
  return res.rows.length > 0;
}

async function loadStoreFromDb(pool) {
  const [competitorsRes, productsRes, historyRes, dashboardRes, countersRes] = await Promise.all(
    [
      pool.query("SELECT * FROM competitors ORDER BY id ASC"),
      pool.query("SELECT * FROM products ORDER BY id ASC"),
      pool.query("SELECT * FROM history ORDER BY id ASC"),
      pool.query("SELECT * FROM dashboard_state"),
      pool.query("SELECT * FROM counters"),
    ]
  );

  const latestHistoryByProduct = new Map();
  for (const row of historyRes.rows) {
    const ts = row.collected_at ? Date.parse(row.collected_at) : NaN;
    const current = latestHistoryByProduct.get(row.product_id);
    if (!current || (Number.isFinite(ts) && ts > current.ts)) {
      latestHistoryByProduct.set(row.product_id, {
        price: row.price != null ? Number(row.price) : null,
        collected_at: row.collected_at ? new Date(row.collected_at).toISOString() : null,
        ts: Number.isFinite(ts) ? ts : -1,
      });
    }
  }

  const dashboard = {};
  for (const row of dashboardRes.rows) {
    dashboard[row.key] = row.value;
  }

  const counters = { competitor: 1, product: 1, history: 1 };
  for (const row of countersRes.rows) {
    counters[row.key] = row.value;
  }

  return {
    competitors: competitorsRes.rows.map((row) => ({
      id: row.id,
      name: row.name,
      website: row.website,
      currency: row.currency,
      website_aliases: row.website_aliases,
      search_presets: row.search_presets,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    })),
    products: productsRes.rows.map((row) => {
      const fallback = latestHistoryByProduct.get(row.id);
      const latestPrice =
        row.latest_price != null
          ? Number(row.latest_price)
          : fallback?.price != null
          ? Number(fallback.price)
          : null;
      const latestCollectedAt =
        row.latest_collected_at
          ? new Date(row.latest_collected_at).toISOString()
          : fallback?.collected_at || null;
      return {
        id: row.id,
        competitor_id: row.competitor_id,
        competitor_name: row.competitor_name,
        product_name: row.product_name,
        category: row.category,
        product_url: row.product_url,
        image: row.image,
        currency: row.currency,
        latest_price: latestPrice,
        latest_collected_at: latestCollectedAt,
      };
    }),
    history: historyRes.rows.map((row) => ({
      id: row.id,
      product_id: row.product_id,
      price: row.price != null ? Number(row.price) : null,
      collected_at: row.collected_at ? new Date(row.collected_at).toISOString() : null,
    })),
    counters,
    dashboard,
    seeded: true,
  };
}

async function saveStoreToDb(pool, store) {
  const client = await pool.connect();
  try {
    await ensureDynamicSchemaFromStore(client, store);
    const dynamicColumns = collectDynamicColumns(store);
    await client.query("BEGIN");
    await client.query("DELETE FROM history");
    await client.query("DELETE FROM products");
    await client.query("DELETE FROM competitors");
    await client.query("DELETE FROM dashboard_state");
    await client.query("DELETE FROM counters");

    const competitorDynCols = Array.from(dynamicColumns.competitors.keys());
    const competitorColumns = [
      "id",
      "name",
      "website",
      "currency",
      "website_aliases",
      "search_presets",
      "created_at",
      "updated_at",
      ...competitorDynCols,
    ];
    for (const competitor of store.competitors || []) {
      const values = [
        competitor.id,
        competitor.name,
        competitor.website,
        competitor.currency,
        competitor.website_aliases || null,
        competitor.search_presets || null,
        competitor.created_at ? new Date(competitor.created_at) : null,
        competitor.updated_at ? new Date(competitor.updated_at) : null,
        ...competitorDynCols.map((key) => competitor?.[key] ?? null),
      ];
      const placeholders = competitorColumns.map((_, idx) => `$${idx + 1}`).join(",");
      const colsSql = competitorColumns.map((c) => `"${c}"`).join(",");
      await client.query(
        `INSERT INTO competitors (${colsSql}) VALUES (${placeholders})`,
        values
      );
    }

    const productDynCols = Array.from(dynamicColumns.products.keys());
    const productColumns = [
      "id",
      "competitor_id",
      "competitor_name",
      "product_name",
      "category",
      "product_url",
      "image",
      "currency",
      "latest_price",
      "latest_collected_at",
      ...productDynCols,
    ];
    for (const product of store.products || []) {
      const values = [
        product.id,
        product.competitor_id,
        product.competitor_name,
        product.product_name,
        product.category,
        product.product_url,
        product.image,
        product.currency,
        product.latest_price,
        product.latest_collected_at ? new Date(product.latest_collected_at) : null,
        ...productDynCols.map((key) => product?.[key] ?? null),
      ];
      const placeholders = productColumns.map((_, idx) => `$${idx + 1}`).join(",");
      const colsSql = productColumns.map((c) => `"${c}"`).join(",");
      await client.query(`INSERT INTO products (${colsSql}) VALUES (${placeholders})`, values);
    }

    const historyDynCols = Array.from(dynamicColumns.history.keys());
    const historyColumns = ["id", "product_id", "price", "collected_at", ...historyDynCols];
    for (const entry of store.history || []) {
      const values = [
        entry.id,
        entry.product_id,
        entry.price,
        entry.collected_at ? new Date(entry.collected_at) : null,
        ...historyDynCols.map((key) => entry?.[key] ?? null),
      ];
      const placeholders = historyColumns.map((_, idx) => `$${idx + 1}`).join(",");
      const colsSql = historyColumns.map((c) => `"${c}"`).join(",");
      await client.query(`INSERT INTO history (${colsSql}) VALUES (${placeholders})`, values);
    }

    for (const [key, value] of Object.entries(store.dashboard || {})) {
      await client.query(
        `INSERT INTO dashboard_state (key, value, updated_at)
         VALUES ($1,$2,$3)`,
        [key, value, value?.updated_at ? new Date(value.updated_at) : null]
      );
    }

    const counters = store.counters || {};
    for (const [key, value] of Object.entries(counters)) {
      await client.query(`INSERT INTO counters (key, value) VALUES ($1,$2)`, [key, value]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function migrateAppStateToDbIfNeeded(pool) {
  const appState = await pool.query("SELECT value FROM app_state WHERE key = $1", [
    "store",
  ]);
  const store = appState.rows?.[0]?.value;
  if (!store || typeof store !== "object") return false;
  await saveStoreToDb(pool, store);
  await pool.query("DELETE FROM app_state WHERE key = $1", ["store"]);
  return true;
}

function requireAdmin(req, res) {
  const token =
    req.headers["x-admin-token"] ||
    req.query.admin_token ||
    req.query.token ||
    "";
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function sanitizeStoreForImport(store) {
  const byCompetitorUrl = new Map();
  const dedupedCompetitors = [];
  for (const competitor of store.competitors || []) {
    const website = String(competitor.website || "").trim();
    if (!website) continue;
    const key = website.toLowerCase();
    if (byCompetitorUrl.has(key)) continue;
    byCompetitorUrl.set(key, competitor);
    dedupedCompetitors.push(competitor);
  }

  const competitorIdMap = new Map();
  for (const competitor of dedupedCompetitors) {
    competitorIdMap.set(competitor.id, competitor);
  }

  const productByKey = new Map();
  const sanitizedProducts = [];
  for (const product of store.products || []) {
    const productUrl = String(product.product_url || "").trim();
    if (!productUrl) continue;
    const competitorId = product.competitor_id;
    if (!competitorIdMap.has(competitorId)) continue;
    const key = `${competitorId}::${productUrl.toLowerCase()}`;
    if (productByKey.has(key)) continue;
    const latestPrice = sanitizeKesPrice(product.latest_price);
    productByKey.set(key, true);
    sanitizedProducts.push({
      ...product,
      latest_price: latestPrice,
    });
  }

  const productIds = new Set(sanitizedProducts.map((p) => p.id));
  const historyByKey = new Set();
  const sanitizedHistory = [];
  for (const entry of store.history || []) {
    if (!productIds.has(entry.product_id)) continue;
    const collectedDay = String(entry.collected_at || "").slice(0, 10);
    const price = sanitizeKesPrice(entry.price);
    if (price == null) continue;
    const key = `${entry.product_id}::${price}::${collectedDay}`;
    if (historyByKey.has(key)) continue;
    historyByKey.add(key);
    sanitizedHistory.push({
      ...entry,
      price,
    });
  }

  return {
    ...store,
    competitors: dedupedCompetitors,
    products: sanitizedProducts,
    history: sanitizedHistory,
  };
}

const BASE_DB_COLUMNS = {
  competitors: new Set([
    "id",
    "name",
    "website",
    "currency",
    "website_aliases",
    "search_presets",
    "created_at",
    "updated_at",
  ]),
  products: new Set([
    "id",
    "competitor_id",
    "competitor_name",
    "product_name",
    "category",
    "product_url",
    "image",
    "currency",
    "latest_price",
    "latest_collected_at",
  ]),
  history: new Set(["id", "product_id", "price", "collected_at"]),
};

function isSafeDbIdentifier(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function inferPgType(value) {
  if (value == null) return "TEXT";
  if (Array.isArray(value)) return "JSONB";
  const t = typeof value;
  if (t === "number") return "NUMERIC";
  if (t === "boolean") return "BOOLEAN";
  if (t === "object") return "JSONB";
  return "TEXT";
}

function mergePgTypes(a, b) {
  if (!a) return b;
  if (a === b) return a;
  if (a === "JSONB" || b === "JSONB") return "JSONB";
  if (a === "TEXT" || b === "TEXT") return "TEXT";
  return "TEXT";
}

function collectDynamicColumns(store) {
  const result = {
    competitors: new Map(),
    products: new Map(),
    history: new Map(),
  };
  const sources = [
    ["competitors", store.competitors],
    ["products", store.products],
    ["history", store.history],
  ];
  for (const [table, rows] of sources) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      for (const [key, value] of Object.entries(row)) {
        if (BASE_DB_COLUMNS[table].has(key)) continue;
        if (!isSafeDbIdentifier(key)) continue;
        const current = result[table].get(key);
        const nextType = inferPgType(value);
        result[table].set(key, mergePgTypes(current, nextType));
      }
    }
  }
  return result;
}

async function getExistingColumns(pool, table) {
  const res = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `,
    [table]
  );
  return new Set(res.rows.map((row) => String(row.column_name).toLowerCase()));
}

async function ensureDynamicColumns(pool, table, columns) {
  if (!columns || columns.size === 0) return;
  const existing = await getExistingColumns(pool, table);
  for (const [name, type] of columns.entries()) {
    const lower = name.toLowerCase();
    if (existing.has(lower)) continue;
    await pool.query(`ALTER TABLE ${table} ADD COLUMN "${name}" ${type}`);
  }
}

async function ensureDynamicSchemaFromStore(pool, store) {
  if (!store || typeof store !== "object") return;
  const dynamic = collectDynamicColumns(store);
  await ensureDynamicColumns(pool, "competitors", dynamic.competitors);
  await ensureDynamicColumns(pool, "products", dynamic.products);
  await ensureDynamicColumns(pool, "history", dynamic.history);
}

async function loadStoreFromDiskIfPresent() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    return null;
  }
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return sanitizeStoreForImport(parsed);
  } catch {
    return null;
  }
}

function buildInitialStore(sourceCompetitors) {
  const seededCompetitors = sourceCompetitors.map((c, idx) => ({
    id: idx + 1,
    name: c.name,
    website: c.website,
    currency: c.currency || null,
    website_aliases: c.website_aliases,
    created_at: new Date().toISOString(),
  }));
  return {
    competitors: seededCompetitors,
    products: [],
    history: [],
    counters: { competitor: seededCompetitors.length + 1, product: 1, history: 1 },
    dashboard: {},
    seeded: true,
  };
}

function loadCompetitorsFromEnv() {
  const raw = process.env.COMPETITORS_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const cleaned = parsed
      .map((item) => ({
        name: String(item?.name || "").trim(),
        website: String(item?.website || "").trim(),
        currency: item?.currency ? String(item.currency).trim().toUpperCase() : null,
        website_aliases: Array.isArray(item?.website_aliases)
          ? item.website_aliases.map((w) => String(w).trim()).filter(Boolean)
          : undefined,
      }))
      .filter((item) => item.name && item.website);
    return cleaned.length ? cleaned : null;
  } catch {
    return null;
  }
}

function resolveBrandCurrency(brand) {
  return BRAND_CURRENCY[brand] || "USD";
}

function resolveForcedCurrency(competitorName, currency) {
  const name = String(competitorName || "").toLowerCase();
  if (name === "diracfashion") {
    const normalized = normalizeCurrencyCode(currency);
    if (!normalized || normalized === "KES") return "USD";
    return normalized;
  }
  return currency;
}

function getCompetitorWebsites(competitor) {
  const websites = new Set();
  if (competitor?.website) websites.add(String(competitor.website));
  return Array.from(websites).filter((website) => {
    try {
      new URL(website);
      return true;
    } catch {
      return false;
    }
  });
}

function isVivoBrandItem() {
  return true;
}

function normalizeLangflowHost(host) {
  if (!host) return "";
  return String(host).replace(/\/+$/, "");
}

function pruneStore(store, daysToKeep = 7) {
  const now = Date.now();
  const cutoff = now - daysToKeep * 24 * 60 * 60 * 1000;
  let changed = false;

  if (Array.isArray(store.history)) {
    const before = store.history.length;
    store.history = store.history.filter((entry) => {
      const ts = Date.parse(entry?.collected_at || "");
      return Number.isFinite(ts) ? ts >= cutoff : true;
    });
    if (store.history.length !== before) changed = true;
  }

  if (store.dashboard && typeof store.dashboard === "object") {
    const keys = Object.keys(store.dashboard);
    for (const key of keys) {
      const updatedAt = store.dashboard[key]?.updated_at;
      const ts = Date.parse(updatedAt || "");
      if (Number.isFinite(ts) && ts < cutoff) {
        delete store.dashboard[key];
        changed = true;
      }
    }
  }

  return changed;
}

async function ensureStore() {
  if (USE_DB) {
    const pool = getDbPool();
    await ensureDbSchema(pool);
    const storeFromDisk = await loadStoreFromDiskIfPresent();
    if (storeFromDisk) {
      await ensureDynamicSchemaFromStore(pool, storeFromDisk);
    }
    const hasData = await hasAnyRows(pool, "competitors");
    if (!hasData) {
      const migrated = await migrateAppStateToDbIfNeeded(pool);
      if (!migrated) {
        if (storeFromDisk) {
          await saveStoreToDb(pool, storeFromDisk);
        } else {
          const envCompetitors = loadCompetitorsFromEnv();
          const sourceCompetitors = envCompetitors || DEFAULT_COMPETITORS;
          const initial = buildInitialStore(sourceCompetitors);
          await saveStoreToDb(pool, initial);
        }
      }
    }
    return;
  }

  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const envCompetitors = loadCompetitorsFromEnv();
    const sourceCompetitors = envCompetitors || DEFAULT_COMPETITORS;
    const initial = buildInitialStore(sourceCompetitors);
    await fs.writeFile(DATA_FILE, JSON.stringify(initial, null, 2), "utf-8");
  }
}

async function readStore() {
  await ensureStore();
  let store;
  if (USE_DB) {
    const pool = getDbPool();
    store = await loadStoreFromDb(pool);
    if (!store || !Array.isArray(store.competitors)) {
      const envCompetitors = loadCompetitorsFromEnv();
      const sourceCompetitors = envCompetitors || DEFAULT_COMPETITORS;
      store = buildInitialStore(sourceCompetitors);
      await writeStore(store);
    }
  } else {
    let raw = await fs.readFile(DATA_FILE, "utf-8");
    try {
      store = JSON.parse(raw);
    } catch (err) {
      const backupPath = `${DATA_FILE}.bak`;
      try {
        const backup = await fs.readFile(backupPath, "utf-8");
        store = JSON.parse(backup);
        await fs.writeFile(DATA_FILE, backup, "utf-8");
      } catch {
        throw err;
      }
    }
  }
  if (!store.dashboard || typeof store.dashboard !== "object") {
    store.dashboard = {};
  }
  let storeChanged = false;
  if (
    Array.isArray(store.competitors) &&
    store.competitors.length === 0 &&
    !store.seeded
  ) {
    const envCompetitors = loadCompetitorsFromEnv();
    const sourceCompetitors = envCompetitors || DEFAULT_COMPETITORS;
    const seededCompetitors = sourceCompetitors.map((c, idx) => ({
      id: idx + 1,
      name: c.name,
      website: c.website,
      currency: c.currency || null,
      website_aliases: c.website_aliases,
      created_at: new Date().toISOString(),
    }));
    store.competitors = seededCompetitors;
    store.counters = store.counters || { competitor: 1, product: 1, history: 1 };
    store.counters.competitor = seededCompetitors.length + 1;
    store.seeded = true;
    storeChanged = true;
  }
  if (pruneStore(store, 7)) {
    storeChanged = true;
  }
  if (storeChanged) {
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
  if (USE_DB) {
    const pool = getDbPool();
    await saveStoreToDb(pool, store);
    return;
  }

  const tmpPath = `${DATA_FILE}.tmp`;
  const backupPath = `${DATA_FILE}.bak`;
  const payload = JSON.stringify(store, null, 2);
  try {
    await fs.copyFile(DATA_FILE, backupPath);
  } catch {
    // ignore missing original
  }
  await fs.writeFile(tmpPath, payload, "utf-8");
  await fs.rename(tmpPath, DATA_FILE);
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

function sanitizeKesPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (amount > 100000 && amount < 10000000) return Number((amount / 100).toFixed(2));
  if (amount >= 10000000) return null;
  return amount;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const shopCurrencyCache = new Map();
const collectionImageCache = new Map();
const productImageCache = new Map();

function normalizeCurrencyCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return null;
  if (code === "KSH") return "KES";
  if (/^[A-Z]{3}$/.test(code)) return code;
  return null;
}

function isCollectionUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.pathname.includes("/collections/") &&
      !parsed.pathname.includes("/products/")
    );
  } catch {
    return false;
  }
}

function isProductUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes("/products/");
  } catch {
    return false;
  }
}

async function fetchCollectionImage(url) {
  if (!url || !isCollectionUrl(url)) return null;
  if (collectionImageCache.has(url)) return collectionImageCache.get(url);
  try {
    const parsed = new URL(url);
    const handle = parsed.pathname.split("/collections/")[1]?.split("/")[0];
    if (!handle) {
      collectionImageCache.set(url, null);
      return null;
    }
    const apiUrl = `${parsed.origin}/collections/${handle}.json`;
    const data = await fetchJson(apiUrl);
    const image =
      data?.collection?.image?.src ||
      data?.collection?.image?.url ||
      data?.products?.[0]?.images?.[0]?.src ||
      data?.products?.[0]?.images?.[0] ||
      null;
    const normalized = image ? normalizeImageUrl(parsed.origin, image) : null;
    collectionImageCache.set(url, normalized);
    return normalized;
  } catch {
    collectionImageCache.set(url, null);
    return null;
  }
}

async function fetchProductImage(url) {
  if (!url || !isProductUrl(url)) return null;
  if (productImageCache.has(url)) return productImageCache.get(url);
  try {
    const parsed = new URL(url);
    const handle = parsed.pathname.split("/products/")[1]?.split("/")[0];
    if (!handle) {
      productImageCache.set(url, null);
      return null;
    }
    const jsUrl = `${parsed.origin}/products/${handle}.js`;
    const data = await fetchJson(jsUrl);
    const image =
      data?.images?.[0] ||
      data?.featured_image ||
      data?.media?.[0]?.src ||
      null;
    const normalized = image ? normalizeImageUrl(parsed.origin, image) : null;
    productImageCache.set(url, normalized);
    return normalized;
  } catch {
    productImageCache.set(url, null);
    return null;
  }
}

const KES_BASE_CURRENCY = "KES";
const FX_DEFAULT_RATES = {
  USD: 129.25,
  EUR: 149.86,
  GBP: 0,
};
const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const fxCache = {
  rates: { ...FX_DEFAULT_RATES },
  fetchedAt: {},
};

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_PAGE_SIZE_DEFAULT = 20;
const SEARCH_PAGE_SIZE_MAX = 20;
const searchCache = new Map();

async function fetchFxRatesToKes(currencies = []) {
  const now = Date.now();
  const requested = new Set(
    ["USD", "EUR", "GBP", ...currencies]
      .map((code) => normalizeCurrencyCode(code))
      .filter(Boolean)
  );

  await Promise.all(
    Array.from(requested).map(async (code) => {
      if (code === KES_BASE_CURRENCY) return;
      const lastFetched = fxCache.fetchedAt[code] || 0;
      if (fxCache.rates[code] && now - lastFetched < FX_CACHE_TTL_MS) return;
      try {
        const data = await fetchJson(
          `https://api.frankfurter.app/latest?from=${code}&to=KES`
        );
        const rate = Number(data?.rates?.KES);
        if (Number.isFinite(rate) && rate > 0) {
          fxCache.rates[code] = rate;
          fxCache.fetchedAt[code] = now;
          return;
        }
      } catch {
        // try fallback provider below
      }

      try {
        const data = await fetchJson(
          `https://open.er-api.com/v6/latest/${code}`
        );
        const rate = Number(data?.rates?.KES);
        if (Number.isFinite(rate) && rate > 0) {
          fxCache.rates[code] = rate;
          fxCache.fetchedAt[code] = now;
        }
      } catch {
        // keep cached/default rate
      }
    })
  );

  return fxCache.rates;
}

function canConvertToKes(currency, rates) {
  const normalized = normalizeCurrencyCode(currency || "");
  if (!normalized || normalized === KES_BASE_CURRENCY) return true;
  return Number.isFinite(rates?.[normalized]) && rates[normalized] > 0;
}

function convertToKes(value, currency, rates) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const normalized = normalizeCurrencyCode(currency || "");
  if (!normalized || normalized === KES_BASE_CURRENCY) return amount;
  const rate = rates?.[normalized];
  if (!rate) return amount;
  return Number((amount * rate).toFixed(2));
}

function applyKesConversion(item, sourceCurrency, fxRates) {
  const normalized = normalizeCurrencyCode(sourceCurrency || "");
  const rate = normalized ? fxRates?.[normalized] : null;
  const canConvert = normalized && normalized !== KES_BASE_CURRENCY && rate;

  if (!canConvert) {
    return {
      currency: normalized || item.currency || null,
      price: item.price ?? null,
      compareAtPrice: item.compareAtPrice ?? null,
      original_currency: null,
      original_price: null,
    };
  }

  return {
    currency: KES_BASE_CURRENCY,
    price: convertToKes(item.price, normalized, fxRates),
    compareAtPrice: convertToKes(item.compareAtPrice, normalized, fxRates),
    original_currency: normalized,
    original_price: item.price ?? null,
  };
}

function currencyFromMoneyFormat(format) {
  if (!format) return null;
  const cleaned = String(format);
  if (/(KES|KSH)/i.test(cleaned)) return "KES";
  if (/(USD|\$)/i.test(cleaned)) return "USD";
  if (/(EUR|â‚¬)/i.test(cleaned)) return "EUR";
  if (/(GBP|Â£)/i.test(cleaned)) return "GBP";
  return null;
}

function currencyFromHtml(html) {
  if (!html) return null;
  const text = String(html);
  const direct =
    text.match(/"currency"\s*:\s*"([A-Z]{3})"/) ||
    text.match(/"currency_code"\s*:\s*"([A-Z]{3})"/) ||
    text.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/) ||
    text.match(/Shopify\.currency\.active\s*=\s*"([A-Z]{3})"/) ||
    text.match(/"money_format"\s*:\s*"([^"]+)"/) ||
    text.match(/money_format\s*:\s*"([^"]+)"/);
  if (!direct) return null;
  if (direct[1] && direct[0].includes("money_format")) {
    return currencyFromMoneyFormat(direct[1]);
  }
  return normalizeCurrencyCode(direct[1]);
}

async function fetchShopCurrency(website) {
  try {
    const origin = new URL(website).origin;
    const host = new URL(website).host.replace(/^www\./, "");
    if (HOST_CURRENCY_OVERRIDES[host]) {
      const override = normalizeCurrencyCode(HOST_CURRENCY_OVERRIDES[host]);
      if (override) return override;
    }
    if (shopCurrencyCache.has(origin)) return shopCurrencyCache.get(origin);

    const candidates = [`${origin}/meta.json`, `${origin}/localization.json`];
    for (const url of candidates) {
      try {
        const data = await fetchJson(url);
        const currency =
          normalizeCurrencyCode(data?.currency) ||
          normalizeCurrencyCode(data?.shop?.currency) ||
          normalizeCurrencyCode(data?.currency?.iso_code) ||
          currencyFromMoneyFormat(data?.money_format) ||
          currencyFromMoneyFormat(data?.moneyFormat) ||
          currencyFromMoneyFormat(data?.shop?.money_format);
        if (currency) {
          shopCurrencyCache.set(origin, currency);
          return currency;
        }
      } catch {
        // try next
      }
    }

    try {
      const html = await fetchText(origin, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      const currency = currencyFromHtml(html);
      shopCurrencyCache.set(origin, currency || null);
      return currency || null;
    } catch {
      shopCurrencyCache.set(origin, null);
      return null;
    }
  } catch {
    return null;
  }
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

function findCurrencyInText(text) {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (/(KES|KSH|KSh)/.test(cleaned)) return "KES";
  if (/\bUSD\b/.test(cleaned)) return "USD";
  if (/\bEUR\b/.test(cleaned) || /â‚¬/.test(cleaned)) return "EUR";
  if (/\bGBP\b/.test(cleaned) || /Â£/.test(cleaned)) return "GBP";
  if (/\$/.test(cleaned)) return "USD";
  return null;
}

function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeImageUrl(baseUrl, image) {
  if (!image) return null;
  const candidate = typeof image === "object" && image.src ? image.src : image;
  const value = String(candidate || "").trim();
  if (!value) return null;
  if (value.startsWith("data:") || value.startsWith("blob:")) return value;
  return absoluteUrl(baseUrl, value);
}

function extractGenericProductsFromHtml(baseUrl, html, limit = 200) {
  const $ = load(html);
  const baseOrigin = new URL(baseUrl).origin;
  const seen = new Set();
  const results = [];
  const pageCurrency =
    normalizeCurrencyCode(
      $('meta[property="product:price:currency"]').attr("content") ||
        $('meta[property="og:price:currency"]').attr("content") ||
        $('meta[itemprop="priceCurrency"]').attr("content")
    ) ||
    findCurrencyInText($("body").text());

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
    const currency =
      findCurrencyInText(containerText) ??
      findCurrencyInText(anchorText) ??
      pageCurrency;

    const img = $(node).find("img").first().length
      ? $(node).find("img").first()
      : container.find("img").first();
    let rawImage =
      img.attr("src") || img.attr("data-src") || img.attr("data-original") || null;
    if (!rawImage) {
      const host = new URL(baseUrl).host.toLowerCase();
      if (host.includes("neviive")) {
        const srcset = img.attr("data-srcset") || img.attr("srcset") || "";
        const first = String(srcset)
          .split(",")[0]
          ?.trim()
          .split(/\s+/)[0];
        if (first) rawImage = first;
      }
    }
    const image = normalizeImageUrl(baseUrl, rawImage);
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
      currency,
      image,
      url: abs,
    });
  }

  return results;
}

function buildSummary(store) {
  const latestUpdates = [...store.history]
    .sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at))
    .map((entry) => {
      const product = store.products.find((p) => p.id === entry.product_id);
      if (!product || !isProductUrl(product.product_url)) return null;
      return {
        product_id: entry.product_id,
        product_name: product?.product_name || "Unknown",
        price: entry.price,
        collected_at: entry.collected_at,
      };
    })
    .filter(Boolean)
    .slice(0, 8);

  const productCount = store.products.filter((p) => isProductUrl(p.product_url)).length;

  return {
    total_competitors: store.competitors.length,
    total_products: productCount,
    latest_updates: latestUpdates,
  };
}

async function buildComparison(store, baseCompetitor, category) {
  const rows = [];
  const grouped = new Map();
  const competitorById = new Map(store.competitors.map((c) => [c.id, c]));
  const currencySet = new Set();
  const entries = [];

  for (const product of store.products) {
    if (!isProductUrl(product.product_url)) continue;
    if (category && product.category !== category) continue;
    if (product.latest_price == null) continue;
    const competitor = competitorById.get(product.competitor_id);
    let sourceCurrency = product.currency || competitor?.currency || null;
    sourceCurrency = resolveForcedCurrency(competitor?.name, sourceCurrency);
    if (sourceCurrency) currencySet.add(sourceCurrency);
    entries.push({
      competitor_name: product.competitor_name,
      price: product.latest_price,
      currency: sourceCurrency,
      collected_at: product.latest_collected_at || null,
    });
  }

  const fxRates = await fetchFxRatesToKes(Array.from(currencySet));
  for (const entry of entries) {
    if (!canConvertToKes(entry.currency, fxRates)) {
      continue;
    }
    const converted = applyKesConversion(
      { price: entry.price, compareAtPrice: null, currency: entry.currency },
      entry.currency,
      fxRates
    );
    const rawPrice = converted.price ?? entry.price;
    const normalizedPrice =
      converted.currency === KES_BASE_CURRENCY
        ? sanitizeKesPrice(rawPrice)
        : rawPrice;
    if (normalizedPrice == null) continue;
    const key = entry.competitor_name;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      price: normalizedPrice,
      collected_at: entry.collected_at,
    });
  }

  let baseAvg = null;
  if (baseCompetitor && grouped.has(baseCompetitor)) {
    const entries = grouped.get(baseCompetitor);
    const slice = entries
      .slice()
      .sort((a, b) => {
        const aTime = Date.parse(a.collected_at || "");
        const bTime = Date.parse(b.collected_at || "");
        const aValid = Number.isFinite(aTime);
        const bValid = Number.isFinite(bTime);
        if (aValid && bValid) return bTime - aTime;
        if (aValid) return -1;
        if (bValid) return 1;
        return 0;
      })
      .slice(0, 20);
    baseAvg =
      slice.reduce((sum, item) => sum + item.price, 0) / slice.length;
  }

  for (const [competitor, entries] of grouped.entries()) {
    const slice = entries
      .slice()
      .sort((a, b) => {
        const aTime = Date.parse(a.collected_at || "");
        const bTime = Date.parse(b.collected_at || "");
        const aValid = Number.isFinite(aTime);
        const bValid = Number.isFinite(bTime);
        if (aValid && bValid) return bTime - aTime;
        if (aValid) return -1;
        if (bValid) return 1;
        return 0;
      })
      .slice(0, 20);
    const avg =
      slice.reduce((sum, item) => sum + item.price, 0) / slice.length;
    const delta = baseAvg != null ? avg - baseAvg : null;
    const deltaPct = baseAvg ? (delta / baseAvg) * 100 : null;
    rows.push({
      competitor,
      items_count: slice.length,
      avg_price: Number(avg.toFixed(2)),
      delta_vs_vivo: delta != null ? Number(delta.toFixed(2)) : null,
      delta_pct_vs_vivo: deltaPct != null ? Number(deltaPct.toFixed(2)) : null,
    });
  }

  rows.sort((a, b) => a.competitor.localeCompare(b.competitor));
  return { base_found: baseAvg != null, base_currency: KES_BASE_CURRENCY, rows };
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
  const storeCurrency = await fetchShopCurrency(parsed.origin);
  const url = `${parsed.origin}/search/suggest.json?q=${encodeURIComponent(
    query
  )}&resources[type]=product`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const products = data?.resources?.results?.products || [];
  return products.map((p) => ({
    title: p.title,
    price: normalizeMoney(p.price),
    image: normalizeImageUrl(parsed.origin, p.image),
    vendor: p.vendor || p.vendorName || p.brand?.name || null,
    currency: p.currency || storeCurrency || null,
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

function resolvePresetKey(normalized) {
  if (normalized.includes("dress")) return "dresses";
  if (normalized.includes("bodysuit")) return "bodysuits";
  if (normalized.includes("bodycon")) return "bodycons";
  if (normalized.includes("skirt")) return "skirts";
  if (normalized.includes("top")) return "tops";
  if (normalized.includes("pant") || normalized.includes("trouser")) return "pants";
  if (normalized.includes("active")) return "activewear";
  if (normalized.includes("outer") || normalized.includes("jacket") || normalized.includes("coat")) return "outerwear";
  return normalized;
}

function buildQueryVariants(query, overrides = {}, competitorName = "") {
  const base = String(query || "").trim();
  if (!base) return [];
  const variants = new Set([base]);
  const lower = base.toLowerCase();
  if (lower.endsWith("s")) variants.add(lower.slice(0, -1));
  if (lower.includes("&")) variants.add(lower.replace(/&/g, "and"));
  if (lower.includes(" and ")) variants.add(lower.replace(/ and /g, " & "));
  const presetKey = resolvePresetKey(lower);
  const globalPresets = overrides?.presets?.global?.[presetKey] || [];
  const namePresets = overrides?.presets?.byName?.[competitorName]?.[presetKey] || [];
  [...globalPresets, ...namePresets].forEach((term) => variants.add(term));
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

function matchesQueryItem(item, query) {
  const normalizedQuery = String(query || "").toLowerCase().trim();
  if (!normalizedQuery) return true;
  const title = String(item?.title || item?.product_name || "").toLowerCase();
  const url = String(item?.url || item?.product_url || "").toLowerCase();
  const slug = slugifyCollectionQuery(normalizedQuery);
  if (slug && url.includes(slug)) return true;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((token) => title.includes(token));
}

function isVivoVendorItem(item) {
  const vendor = String(item?.vendor || "").trim().toLowerCase();
  return vendor === "vivo";
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
  const storeCurrency = await fetchShopCurrency(parsed.origin);
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
      const imageCandidate = p.image?.src || p.images?.[0]?.src || p.images?.[0] || null;
      return {
        title: p.title,
        price: firstVariant.price ? Number(firstVariant.price) : null,
        compareAtPrice: firstVariant.compare_at_price
          ? Number(firstVariant.compare_at_price)
          : null,
        vendor: p.vendor || null,
        image: normalizeImageUrl(parsed.origin, imageCandidate),
        images: p.images.map((img) => img.src),
        url: `${parsed.origin}/products/${p.handle}`,
        currency: storeCurrency || currency || null,
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

function matchesAnyQueryVariant(product, variants) {
  if (!Array.isArray(variants) || variants.length === 0) return true;
  const title = String(product?.title || "").toLowerCase();
  const handle = String(product?.handle || "").toLowerCase();
  const vendor = String(product?.vendor || "").toLowerCase();
  const productType = String(product?.product_type || "").toLowerCase();
  const tags = Array.isArray(product?.tags) ? product.tags.join(" ").toLowerCase() : String(product?.tags || "").toLowerCase();
  return variants.some((variant) => {
    if (!variant) return false;
    const needle = String(variant).toLowerCase();
    return (
      title.includes(needle) ||
      handle.includes(needle) ||
      vendor.includes(needle) ||
      productType.includes(needle) ||
      tags.includes(needle)
    );
  });
}

async function scrapeShopifyAllProducts(origin, queryVariants, currency, { maxPages = 8 } = {}) {
  const storeCurrency = await fetchShopCurrency(origin);
  const products = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    const apiUrl = `${origin}/products.json?limit=250&page=${page}`;
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) {
      break;
    }
    const data = await response.json();
    if (!data.products || data.products.length === 0) {
      hasMore = false;
      break;
    }

    for (const p of data.products) {
      if (!matchesAnyQueryVariant(p, queryVariants)) continue;
      const firstVariant = p.variants?.[0] || {};
      const imageCandidate = p.image?.src || p.images?.[0]?.src || p.images?.[0] || null;
      products.push({
        title: p.title,
        price: firstVariant.price ? Number(firstVariant.price) : null,
        compareAtPrice: firstVariant.compare_at_price ? Number(firstVariant.compare_at_price) : null,
        vendor: p.vendor || null,
        image: normalizeImageUrl(origin, imageCandidate),
        images: p.images.map((img) => img.src),
        url: `${origin}/products/${p.handle}`,
        currency: storeCurrency || currency || null,
      });
    }

    if (data.products.length < 250) {
      hasMore = false;
    }
    page += 1;
  }

  return products;
}


app.get("/", (req, res) => {
  res.send("Welcome to the Web Scraper API!");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/api/admin/import-store", async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    if (!USE_DB) {
      return res.status(400).json({ error: "DATABASE_URL is not configured." });
    }
    const pool = getDbPool();
    await ensureDbSchema(pool);
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const store = sanitizeStoreForImport(JSON.parse(raw));
    if (!store || typeof store !== "object") {
      return res.status(400).json({ error: "Invalid store.json content." });
    }
    await saveStoreToDb(pool, store);
    res.status(200).json({ ok: true, message: "Imported store.json into database." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/dashboard/state", async (req, res) => {
  try {
    const store = await readStore();
    res.status(200).json(store.dashboard || {});
  } catch (error) {
    try {
      const store = await readStore();
      const competitor = store.competitors.find(
        (c) => String(c.id) === String(req.params.id)
      );
      const fallback = buildStoredSearchResults(
        store,
        competitor?.id,
        req.query.q || req.query.query,
        competitor?.currency || null
      );
      const hasData = fallback.length > 0;
      return res.status(200).json({
        success: hasData,
        count: fallback.length,
        data: fallback,
        failed: hasData ? [] : competitor ? [competitor.name] : [],
        error: error.message,
      });
    } catch {
      res.status(500).json({ error: error.message });
    }
  }
});

app.post("/api/dashboard/state", async (req, res) => {
  try {
    const store = await readStore();
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    store.dashboard = {
      ...(store.dashboard || {}),
      ...payload,
      updated_at: new Date().toISOString(),
    };
    await writeStore(store);
    res.status(200).json(store.dashboard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
    const queryValue = String(req.query.q || req.query.query || "").trim();
    const categoryParam = String(req.query.category || "").trim();
    const effectiveQuery = categoryParam || queryValue;

    const store = await readStore();
    const competitor = store.competitors.find(
      (c) => String(c.id) === String(req.params.id)
    );
    if (!competitor) {
      return res.status(404).json({ error: "Competitor not found." });
    }

    const persistFlag = String(req.query.persist || "").toLowerCase();
    const shouldPersist = persistFlag === "1" || persistFlag === "true" || persistFlag === "yes";
    const refreshFlag = String(req.query.refresh || "").toLowerCase();
    const shouldRefresh = refreshFlag === "1" || refreshFlag === "true" || refreshFlag === "yes";
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(
      1,
      Math.min(SEARCH_PAGE_SIZE_MAX, Number(req.query.page_size) || SEARCH_PAGE_SIZE_DEFAULT)
    );
    const cacheKey = `${competitor.id}:${String(effectiveQuery).toLowerCase()}`;
    const cached = searchCache.get(cacheKey);

    function buildPagedResponse(payload) {
      const total = payload.data.length;
      const start = (page - 1) * pageSize;
      const paged = payload.data.slice(start, start + pageSize);
      return {
        ...payload,
        data: paged,
        count: paged.length,
        total,
        page,
        page_size: pageSize,
        has_more: start + pageSize < total,
      };
    }

    const storeCache = store.dashboard?.search_cache?.[cacheKey];
    if (!shouldRefresh) {
      if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) {
        return res.status(200).json(buildPagedResponse(cached.payload));
      }
      if (storeCache && Date.now() - storeCache.at < SEARCH_CACHE_TTL_MS) {
        const payload = {
          success: true,
          count: storeCache.data.length,
          data: storeCache.data,
          competitor: { id: competitor.id, name: competitor.name },
          persisted: storeCache.persisted || { created: 0, updated: 0, history: 0 },
        };
        searchCache.set(cacheKey, { at: storeCache.at, payload });
        return res.status(200).json(buildPagedResponse(payload));
      }
    }

    const products = [];
    const seenUrls = new Set();
    const maxResults = 20;

    function addProducts(items) {
      if (!Array.isArray(items) || !items.length) return;
      for (const item of items) {
        if (products.length >= maxResults) return;
        const url = item?.url || item?.product_url || "";
        const title = String(item?.title || item?.product_name || "").toLowerCase();
        if (title.includes("add to cart")) continue;
        if (!url) continue;
        const key = String(url).split("?")[0];
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        products.push(item);
      }
    }

    const overrides = await loadCollectionOverrides();
    const websites = getCompetitorWebsites(competitor);
    const queryVariants = effectiveQuery
      ? buildQueryVariants(effectiveQuery, overrides, competitor.name)
      : [];
    let scrapeError = null;

    try {
      for (const website of websites) {
        const overrideCandidates = effectiveQuery
          ? expandCollectionCandidates(
              buildOverrideCandidates(website, competitor.name, effectiveQuery, overrides)
            )
          : [];
        for (const candidate of overrideCandidates) {
          try {
            const found = await scrapeShopifyCollection(candidate, competitor.currency);
            addProducts(found);
          } catch {
            // try next candidate
          }
        }

        for (const candidate of overrideCandidates) {
          try {
            const found = await scrapeCollectionHtml(candidate);
            addProducts(found);
          } catch {
            // try next candidate
          }
        }

        const collectionCandidates = effectiveQuery
          ? expandCollectionCandidates(buildCollectionCandidates(website, effectiveQuery))
          : [];
        for (const candidate of collectionCandidates) {
          try {
            const found = await scrapeShopifyCollection(candidate, competitor.currency);
            addProducts(found);
          } catch {
            // try next candidate
          }
        }

        for (const candidate of collectionCandidates) {
          try {
            const found = await scrapeCollectionHtml(candidate);
            addProducts(found);
          } catch {
            // try next candidate
          }
        }

        const discoveredCollections = effectiveQuery
          ? await findShopifyCollections(website, effectiveQuery)
          : [];
        const discoveredCandidates = expandCollectionCandidates(discoveredCollections);
        for (const candidate of discoveredCandidates) {
          try {
            const found = await scrapeShopifyCollection(candidate, competitor.currency);
            addProducts(found);
          } catch {
            // try next candidate
          }
        }

        for (const candidate of discoveredCandidates) {
          try {
            const found = await scrapeCollectionHtml(candidate);
            addProducts(found);
          } catch {
            // try next candidate
          }
        }

        for (const variant of queryVariants) {
          try {
            const foundShopify = await shopifySearchProducts(website, variant);
            addProducts(foundShopify);
            const foundGeneric = await genericSearchProducts(website, variant);
            addProducts(foundGeneric);
          } catch {
            try {
              const foundGeneric = await genericSearchProducts(website, variant);
              addProducts(foundGeneric);
            } catch {
              // ignore
            }
          }
        }
      }
    } catch (err) {
      scrapeError = err;
    }

    if (!products.length) {
      const stored = buildStoredSearchResults(
        store,
        competitor.id,
        effectiveQuery,
        competitor.currency
      );
      addProducts(stored);
    }

    if (products.length < maxResults) {
      const fallbackPages = 2;
      for (const website of websites) {
        try {
          const fallback = await scrapeShopifyAllProducts(
            website,
            queryVariants,
            competitor.currency,
            { maxPages: fallbackPages }
          );
          addProducts(fallback);
        } catch {
          // ignore fallback errors
        }
      }
    }

    const storeCurrency = await fetchShopCurrency(competitor.website);
    const currencySet = new Set([
      competitor.currency,
      storeCurrency,
      ...products.map((p) => p.currency),
    ]);
    const fxRates = await fetchFxRatesToKes(Array.from(currencySet));
    const data = products
      .map((p) => {
        let sourceCurrency = p.currency || storeCurrency || null;
        sourceCurrency = resolveForcedCurrency(competitor.name, sourceCurrency);
        const converted = applyKesConversion(p, sourceCurrency, fxRates);
        return {
          ...p,
          brand: competitor.name,
          ...converted,
        };
      })
      .filter((item) => isProductUrl(item.url || item.product_url));
    let filteredData = data.filter((item) => matchesQueryItem(item, effectiveQuery));
    if (String(competitor.name || "").toLowerCase() === "vivo") {
      filteredData = filteredData.filter(isVivoVendorItem);
    }

    const missingImages = filteredData.filter((item) => !item.image && item.url);
    if (missingImages.length) {
      const limit = missingImages.slice(0, 25);
      await Promise.all(
        limit.map(async (item) => {
          let img = null;
          if (isCollectionUrl(item.url)) {
            img = await fetchCollectionImage(item.url);
          } else if (isProductUrl(item.url)) {
            img = await fetchProductImage(item.url);
          }
          if (img) item.image = img;
        })
      );
    }

    let persisted = { created: 0, updated: 0, history: 0 };
    if (shouldPersist) {
      const collectedAt = new Date().toISOString();
      const collectedDay = collectedAt.slice(0, 10);
      for (const item of filteredData) {
        const productUrl = item.url || item.product_url || "";
        if (!productUrl || !isProductUrl(productUrl)) continue;
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
            image:
              item.image ||
              (Array.isArray(item.images) ? item.images[0] : null) ||
              null,
            currency: resolveForcedCurrency(
              competitor.name,
              item.currency || competitor.currency || null
            ),
            latest_price: null,
            latest_collected_at: null,
          };
          store.products.push(product);
          persisted.created += 1;
        } else {
          product.product_name = item.title || item.product_name || product.product_name;
          product.currency = resolveForcedCurrency(
            competitor.name,
            item.currency || product.currency || competitor.currency || null
          );
          if (!product.image && item.image) {
            product.image = item.image;
          }
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

    store.dashboard = store.dashboard || {};
    store.dashboard.search = {
      competitor_id: competitor.id,
      competitor_name: competitor.name,
      query: effectiveQuery,
      result: { success: true, count: filteredData.length, data: filteredData, failed: [] },
      updated_at: new Date().toISOString(),
    };

    const responsePayload = {
      success: true,
      count: filteredData.length,
      data: filteredData,
      competitor: { id: competitor.id, name: competitor.name },
      persisted,
    };

    const cacheEntry = { at: Date.now(), payload: responsePayload };
    searchCache.set(cacheKey, cacheEntry);
    store.dashboard = store.dashboard || {};
    store.dashboard.search_cache = store.dashboard.search_cache || {};
    store.dashboard.search_cache[cacheKey] = {
      at: cacheEntry.at,
      data: filteredData,
      persisted,
    };
    await writeStore(store);

    res.status(200).json(buildPagedResponse(responsePayload));
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
    const currencySet = new Set([currency, ...products.map((item) => item.currency)]);
    const fxRates = await fetchFxRatesToKes(Array.from(currencySet));
    const normalizedProducts = products.map((item) => {
      const sourceCurrency = item.currency || currency || null;
      const converted = applyKesConversion(item, sourceCurrency, fxRates);
      return {
        ...item,
        ...converted,
      };
    });
    const store = await readStore();
    store.dashboard = store.dashboard || {};
    store.dashboard.collection = {
      url,
      currency,
      result: {
        success: true,
        count: normalizedProducts.length,
        data: normalizedProducts,
      },
      updated_at: new Date().toISOString(),
    };
    await writeStore(store);
    res.status(200).json({
      success: true,
      count: normalizedProducts.length,
      data: normalizedProducts,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const store = await readStore();
    const productEntries = store.products.filter((p) => isProductUrl(p.product_url));
    const currencySet = new Set(productEntries.map((p) => p.currency).filter(Boolean));
    const fxRates = await fetchFxRatesToKes(Array.from(currencySet));
    const products = productEntries.map((product) => {
      const competitor = store.competitors.find(
        (c) => String(c.id) === String(product.competitor_id)
      );
      let sourceCurrency = product.currency || null;
      sourceCurrency = resolveForcedCurrency(competitor?.name, sourceCurrency);
      const converted = applyKesConversion(
        { price: product.latest_price, compareAtPrice: null, currency: sourceCurrency },
        sourceCurrency,
        fxRates
      );
      const safeLatestPrice =
        converted.currency === KES_BASE_CURRENCY
          ? sanitizeKesPrice(converted.price)
          : converted.price;
      return {
        ...product,
        competitor_currency: competitor?.currency || null,
        original_currency: converted.original_currency,
        original_latest_price: converted.original_price,
        currency: converted.currency || sourceCurrency,
        latest_price: safeLatestPrice,
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
    if (!isProductUrl(product_url)) {
      return res.status(400).json({ error: "Product URL must be a /products/ link." });
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
    let sourceCurrency = product.currency || null;
    sourceCurrency = resolveForcedCurrency(competitor?.name, sourceCurrency);
    const fxRates = await fetchFxRatesToKes([sourceCurrency]);

    const points = store.history
      .filter((h) => h.product_id === id)
      .sort((a, b) => new Date(a.collected_at) - new Date(b.collected_at))
      .map((point) => {
        const converted = applyKesConversion(
          { price: point.price, compareAtPrice: null, currency: sourceCurrency },
          sourceCurrency,
          fxRates
        );
        return {
          ...point,
          original_currency: converted.original_currency,
          original_price: converted.original_price,
          currency: converted.currency || sourceCurrency,
          price: converted.price,
        };
      });

    const productConverted = applyKesConversion(
      { price: product.latest_price, compareAtPrice: null, currency: sourceCurrency },
      sourceCurrency,
      fxRates
    );

    res.status(200).json({
      product: {
        ...product,
        competitor_currency: competitor?.currency || null,
        original_currency: productConverted.original_currency,
        original_latest_price: productConverted.original_price,
        currency: productConverted.currency || sourceCurrency,
        latest_price: productConverted.price,
      },
      points,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/history/brands", async (req, res) => {
  try {
    const store = await readStore();
    const category = String(req.query.category || "").trim();
    const products = store.products.filter(
      (product) =>
        isProductUrl(product.product_url) &&
        (!category || product.category === category)
    );
    const productById = new Map(products.map((product) => [product.id, product]));
    const currencies = Array.from(
      new Set(products.map((product) => product.currency).filter(Boolean))
    );
    const fxRates = await fetchFxRatesToKes(currencies);
    const labelsSet = new Set();
    const seriesMap = new Map();

    for (const entry of store.history) {
      const product = productById.get(entry.product_id);
      if (!product) continue;
      const forcedCurrency = resolveForcedCurrency(product.competitor_name, product.currency);
      const converted = applyKesConversion(
        { price: entry.price, compareAtPrice: null, currency: forcedCurrency },
        forcedCurrency,
        fxRates
      );
      const price = Number(converted.price);
      if (!Number.isFinite(price)) continue;
      const dateKey = new Date(entry.collected_at).toISOString().slice(0, 10);
      labelsSet.add(dateKey);
      const brand = product.competitor_name || "Unknown";
      if (!seriesMap.has(brand)) seriesMap.set(brand, new Map());
      const brandMap = seriesMap.get(brand);
      const bucket = brandMap.get(dateKey) || { sum: 0, count: 0 };
      bucket.sum += price;
      bucket.count += 1;
      brandMap.set(dateKey, bucket);
    }

    const labels = Array.from(labelsSet).sort();
    const series = Array.from(seriesMap.entries()).map(([brand, brandMap]) => ({
      brand,
      data: labels.map((label) => {
        const bucket = brandMap.get(label);
        if (!bucket) return null;
        return Number((bucket.sum / bucket.count).toFixed(2));
      }),
    }));

    res.status(200).json({ labels, series, currency: "KES" });
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
    const result = await buildComparison(store, base, category);
    store.dashboard = store.dashboard || {};
    store.dashboard.comparison = {
      filters: { base_competitor: base, category },
      result,
      updated_at: new Date().toISOString(),
    };
    await writeStore(store);
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
        const storeCurrency = await fetchShopCurrency(competitor.website);
        const sourceCurrency = competitor.currency || storeCurrency || null;
        const fxRates = await fetchFxRatesToKes([sourceCurrency]);
        const converted = applyKesConversion(
          { price: result.price, compareAtPrice: null, currency: sourceCurrency },
          sourceCurrency,
          fxRates
        );
        const displayPrice = converted.price ?? result.price;

        if (competitor.name === base_competitor) {
          baseFound = true;
          basePrice = displayPrice;
        }

        matches.push({
          competitor: competitor.name,
          product_name: result.product_name,
          price: displayPrice,
          currency: converted.currency || sourceCurrency || null,
          original_currency: converted.original_currency,
          original_price: converted.original_price,
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

    store.dashboard = store.dashboard || {};
    store.dashboard.live_compare = {
      input: { product_name, base_competitor },
      result: { base_found: baseFound, matches, failed },
      updated_at: new Date().toISOString(),
    };
    await writeStore(store);

    res.status(200).json({
      base_found: baseFound,
      base_currency: KES_BASE_CURRENCY,
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
        price: normalizeMoney(p.price),
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
        price: normalizeMoney(p.price),
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
        price: normalizeMoney(p.price),
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
        price: normalizeMoney(p.price),
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
        price: normalizeMoney(p.price),
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
        price: normalizeMoney(p.price),
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
        price: normalizeMoney(p.price),
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
        price: normalizeMoney(p.price),
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
        price: normalizeMoney(p.price),
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
        price: normalizeMoney(p.price),
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
        price: normalizeMoney(p.price),
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


if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server is running on localhost:${PORT}`);
  });
}

export default app;
