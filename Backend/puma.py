import requests
from bs4 import BeautifulSoup
import pandas as pd

# CHANGE THIS to the category you want to scrape
CATEGORY_URL = "https://us.puma.com/us/en/men/shoes"

BASE_URL = "https://us.puma.com"
HEADERS = {"User-Agent": "Mozilla/5.0"}

def scrape_puma_products(url):
    products = []
    response = requests.get(url, headers=HEADERS)

    if response.status_code != 200:
        print("Failed to load page.")
        return products

    soup = BeautifulSoup(response.text, "html.parser")
    items = soup.select("li.product-tile")

    for item in items:
        title_tag = item.select_one("div.product-name")
        image_tag = item.select_one("img.product-image")

        if not title_tag or not image_tag:
            continue

        title = title_tag.get_text(strip=True)
        handle = title.lower().replace(" ", "-").replace("/", "-")
        image_url = image_tag.get("src")

        if image_url and not image_url.startswith("http"):
            image_url = BASE_URL + image_url

        products.append({
            "Handle": handle,
            "Title": title,
            "Image Src": image_url
        })

    return products

# Run it
print("Scraping Puma products...")
product_data = scrape_puma_products(CATEGORY_URL)

# Save to Shopify-ready CSV
if product_data:
    df = pd.DataFrame(product_data)
    df.to_csv("puma_products_for_shopify.csv", index=False)
    print("✅ CSV created: puma_products_for_shopify.csv")
else:
    print("⚠️ No products found or unable to scrape.")