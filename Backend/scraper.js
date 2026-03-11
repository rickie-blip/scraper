import fs from "fs/promises";
import path from "path";
import { writeToPath } from "@fast-csv/format";
import { load } from "cheerio";
import puppeteer from "puppeteer";
import nodemailer from "nodemailer";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function normalizeUrl(input) {
  try {
    return new URL(input).toString();
  } catch {
    return "";
  }
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

function isShopifyCollection(url) {
  return /\/collections\//i.test(url);
}

function getShopifyCollectionHandle(url) {
  const match = url.match(/\/collections\/([^/?#]+)/i);
  return match ? match[1] : "";
}

function normalizeMoney(value) {
  if (value == null || value === "") return null;
  const cleaned = String(value).replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : null;
}

function normalizeShopifyImage(src) {
  if (!src) return "";
  let output = src;
  if (output.startsWith("//")) output = `https:${output}`;
  output = output.replace(/\/cdn\/shop\/s\/files\/[^/]+\/files\//, "/cdn/shop/files/");
  return output;
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

export async function scrapeShopifyCollectionJson(url, { currency } = {}) {
  const normalized = normalizeUrl(url);
  if (!normalized) throw new Error("Invalid URL");
  const handle = getShopifyCollectionHandle(normalized);
  if (!handle) throw new Error("Invalid Shopify collection URL.");

  const parsed = new URL(normalized);
  const origin = parsed.origin;
  const products = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const apiUrl = `${origin}/collections/${handle}/products.json?limit=250&page=${page}`;
    const data = await fetchJson(apiUrl);
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
        images: (p.images || []).map((img) => img.src),
        url: `${origin}/products/${p.handle}`,
        currency: currency || null,
      };
    });

    products.push(...mapped);
    if (data.products.length < 250) hasMore = false;
    page += 1;
  }

  return products;
}

async function collectShopifyProductLinks(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(DEFAULT_USER_AGENT);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  let prevHeight = 0;
  for (let i = 0; i < 12; i += 1) {
    const height = await page.evaluate("document.body.scrollHeight");
    if (height === prevHeight) break;
    prevHeight = height;
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await new Promise((r) => setTimeout(r, 1000));
  }

  const links = await page.evaluate(() =>
    Array.from(new Set(
      Array.from(document.querySelectorAll("a[href*='/products/']")).map((a) => a.href.split("?")[0])
    ))
  );

  await browser.close();
  return links;
}

export async function scrapeShopifyProductsFromLinks(links, { currency } = {}) {
  const products = [];
  for (const link of links) {
    const jsonUrl = `${stripTrailingSlash(link)}.js`;
    try {
      const data = await fetchJson(jsonUrl);
      const variants = data.variants || [];
      const sizes = Array.from(
        new Set(
          variants
            .map((v) => v.option1)
            .filter((v) => v && v !== "Default Title")
        )
      );
      products.push({
        title: data.title || "",
        description: data.body_html || "",
        price: normalizeMoney(variants[0]?.price),
        compareAtPrice: normalizeMoney(variants[0]?.compare_at_price),
        images: (data.images || []).map(normalizeShopifyImage),
        sizes,
        url: link,
        currency: currency || null,
      });
    } catch {
      // ignore failures per product
    }
  }
  return products;
}

export async function scrapeShopifyPage(url, options = {}) {
  const links = await collectShopifyProductLinks(url);
  return scrapeShopifyProductsFromLinks(links, options);
}

function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
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
    if (!abs || !abs.startsWith(baseOrigin)) continue;
    if (seen.has(abs)) continue;

    const anchorText = $(node).text().replace(/\s+/g, " ").trim();
    const container = $(node).closest("li, article, div");
    const containerText = container.text().replace(/\s+/g, " ").trim();
    const price = findPriceInText(containerText) ?? findPriceInText(anchorText);

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

export async function scrapeGeneric(url) {
  const html = await fetchText(url, { headers: { "User-Agent": DEFAULT_USER_AGENT } });
  return extractGenericProductsFromHtml(url, html);
}

export async function scrapePuma(url) {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  });
  const page = await browser.newPage();
  await page.setUserAgent(DEFAULT_USER_AGENT);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  const products = await page.evaluate(() => {
    const results = [];
    const productElements = document.querySelectorAll("[data-product-id]");

    productElements.forEach((element, index) => {
      const titleElement = element.querySelector(
        "h1, h2, h3, h4, .title, .name, [data-testid*='title'], [data-testid*='name'], a[href*='/pd/']"
      );
      const priceElement = element.querySelector(".price, [data-testid*='price'], .cost, .amount, [class*='price']");
      const imageElement = element.querySelector("img");
      const linkElement = element.querySelector("a[href*='/pd/']") || element.querySelector("a");

      const title = titleElement?.textContent?.trim() || "";
      const price = priceElement?.textContent?.trim() || "";
      const image = imageElement?.src || imageElement?.getAttribute("data-src") || "";
      const link = linkElement?.href || "";
      const productId =
        element.getAttribute("data-product-id") ||
        element.getAttribute("data-productid") ||
        (link.match(/\/(\d+)/) && link.match(/\/(\d+)/)[1]) ||
        `extracted-${index}`;

      if (title) {
        results.push({
          title,
          price,
          image,
          link,
          productId,
          extractedAt: new Date().toISOString(),
        });
      }
    });

    return results;
  });

  await browser.close();
  return products;
}

export async function scrapeCollection(url, options = {}) {
  const normalized = normalizeUrl(url);
  if (!normalized) throw new Error("Invalid URL");

  const mode = options.mode || "auto";
  if (mode === "puma") return scrapePuma(normalized);
  if (mode === "shopify-collection") return scrapeShopifyCollectionJson(normalized, options);
  if (mode === "shopify-page") return scrapeShopifyPage(normalized, options);
  if (mode === "generic") return scrapeGeneric(normalized);

  if (normalized.includes("puma.com")) {
    return scrapePuma(normalized);
  }

  if (isShopifyCollection(normalized)) {
    try {
      return await scrapeShopifyCollectionJson(normalized, options);
    } catch {
      return scrapeShopifyPage(normalized, options);
    }
  }

  try {
    return await scrapeShopifyPage(normalized, options);
  } catch {
    return scrapeGeneric(normalized);
  }
}

export async function saveOutput(data, { format = "json", output } = {}) {
  if (!output) return "";
  if (format === "csv") {
    await writeToPath(output, data, { headers: true });
    return output;
  }
  await fs.writeFile(output, JSON.stringify(data, null, 2), "utf-8");
  return output;
}

async function sendEmailWithAttachment(filePath) {
  const sender = process.env.SENDER_EMAIL;
  const password = process.env.SENDER_PWD;
  if (!sender || !password) {
    console.log("Email not sent: missing SENDER_EMAIL or SENDER_PWD.");
    return false;
  }

  const recipients = (process.env.SCRAPER_EMAIL_RECIPIENTS || "nigel@shopzetu.com,patrick@shopzetu.com")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!recipients.length) {
    console.log("Email not sent: no recipients configured.");
    return false;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: sender, pass: password },
  });

  await transporter.sendMail({
    from: sender,
    to: recipients.join(", "),
    subject: `Scraper export - ${path.basename(filePath)}`,
    text: "Attached is the latest scraper export.",
    attachments: [{ filename: path.basename(filePath), path: filePath }],
  });

  console.log(`Email sent to ${recipients.join(", ")}`);
  return true;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--")) continue;
    args[key.slice(2)] = value ?? true;
  }
  return args;
}

async function runCli() {
  const args = parseArgs(process.argv);
  const url =
    args.url ||
    process.env.COLLECTION_URL ||
    process.env.SCRAPE_URL ||
    "";
  if (!url) {
    console.error("Provide --url or set COLLECTION_URL/SCRAPE_URL");
    process.exit(1);
  }

  const format = (args.format || "json").toLowerCase();
  const output =
    args.output ||
    (format === "csv"
      ? `scrape_${Date.now()}.csv`
      : `scrape_${Date.now()}.json`);
  const mode = args.mode || "auto";
  const currency = args.currency || "";
  const sendEmail = args.email === "true" || args.email === true;

  const data = await scrapeCollection(url, { mode, currency });
  const saved = await saveOutput(data, { format, output });
  console.log(`Saved ${data.length || 0} records to ${saved}`);
  if (sendEmail && saved) {
    await sendEmailWithAttachment(saved);
  }
}

if (process.argv[1]?.includes("scraper.js")) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
