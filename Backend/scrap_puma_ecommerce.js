import dotenv from "dotenv";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { type } from "os";

dotenv.config();

const COLLECTION_URL =
  "https://nalaniwomen.com/search?q=BODYSUITS&options%5Bprefix%5D=last";

const OUTPUT_FILE = "etam_womens_night_wear.csv";
const EMAIL_SUBJECT = "Etam Women's Nightwear";

const COLLECTION_META = {
  vendor: "Nalani",
  type: "Bodysuits",
  tags: "BODYSUITS,CLOTHING",
};

/* -----------------------------
   Helpers
----------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const formatPrice = (value) => (value ? (value / 100).toFixed(2) : "");

const handleize = (str) =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

/* -----------------------------
   Email sender
----------------------------- */
async function sendEmailWithCSV(csvPath) {
  if (!process.env.SENDER_EMAIL || !process.env.SENDER_PWD) {
    console.log("⚠️ Email not sent — missing env vars");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SENDER_EMAIL,
      pass: process.env.SENDER_PWD,
    },
  });

  await transporter.verify();

  await transporter.sendMail({
    from: process.env.SENDER_EMAIL,
    to: ["nigel@shopzetu.com"],
    subject: `${EMAIL_SUBJECT} – ${new Date().toLocaleDateString()}`,
    html: `
      <h2>🛍️ Nalani BodySuits Shopify Extraction</h2>
      <p>The Shopify-ready CSV has been generated and is attached.</p>
      <ul>
        <li>Source: nalaniwomen.com</li>
        <li>Format: Shopify Products CSV</li>
        <li>Generated: ${new Date().toLocaleString()}</li>
      </ul>
    `,
    attachments: [
      {
        filename: path.basename(csvPath),
        path: csvPath,
        contentType: "text/csv",
      },
    ],
  });

  console.log("📧 Email sent with CSV attachment");
}

/* -----------------------------
   Main scraper
----------------------------- */
async function scrapeCollection(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2" });

  /* Scroll */
  let lastHeight = 0;
  while (true) {
    const height = await page.evaluate(() => document.body.scrollHeight);

    if (height === lastHeight) break;
    lastHeight = height;

    await page.evaluate(() => {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth",
      });
    });

    await sleep(1000);
  }

  /* Collect product URLs */
  const productLinks = await page.evaluate(() => [
    ...new Set(
      Array.from(document.querySelectorAll("a[href*='/products/']")).map(
        (a) => a.href.split("?")[0]
      )
    ),
  ]);

  const rows = [];

  /* CSV Header */
  rows.push([
    "Handle",
    "Title",
    "Body (HTML)",
    "Vendor",
    "Type",
    "Tags",
    "Option1 Name",
    "Option1 Value",
    "Variant Price",
    "Variant Compare At Price",
    "Image Src",
    "Image Position",
    "Status",
  ]);

  /* Fetch products */
  for (const link of productLinks) {
    const product = await page.evaluate(async (jsonUrl) => {
      const res = await fetch(jsonUrl);
      const data = await res.json();

      const normalizeImageUrl = (src) => {
        if (!src) return "";
        if (src.startsWith("//")) src = "https:" + src;
        return src.replace(
          /\/cdn\/shop\/s\/files\/[^/]+\/files\//,
          "/cdn/shop/files/"
        );
      };

      return {
        title: data.title,
        description: data.body_html,
        images: data.images.map(normalizeImageUrl),
        variants: data.variants.map((v) => ({
          size: v.option1,
          price: v.price,
          compareAt: v.compare_at_price,
        })),
      };
    }, `${link}.js`);

    const handle = handleize(product.title);
    const sizes = product.variants.filter(
      (v) => v.size && v.size !== "Default Title"
    );

    sizes.forEach((variant, i) => {
      rows.push([
        handle,
        i === 0 ? product.title : "",
        i === 0 ? product.description : "",
        COLLECTION_META.vendor,
        COLLECTION_META.type,
        COLLECTION_META.tags,
        "Size",
        variant.size,
        formatPrice(variant.price),
        formatPrice(variant.compareAt),
        product.images[0] || "",
        "1",
        "active",
      ]);
    });

    product.images.slice(1).forEach((img, i) => {
      rows.push([handle, "", "", "", "", "", "", "", "", "", img, i + 2, ""]);
    });

    console.log(`✅ ${product.title}`);
    await sleep(300);
  }

  /* Write CSV */
  const csv = rows
    .map((row) =>
      row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  fs.writeFileSync(path.resolve(OUTPUT_FILE), csv);

  console.log(`📦 CSV created: ${OUTPUT_FILE}`);

  await browser.close();

  /* Send email */
  await sendEmailWithCSV(path.resolve(OUTPUT_FILE));
}

/* Run */
scrapeCollection(COLLECTION_URL).catch(console.error);
