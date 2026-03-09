import re
from decimal import Decimal, InvalidOperation

import requests
from bs4 import BeautifulSoup

from Backend.database import db
from Backend.models import PriceHistory, Product


PRICE_SELECTORS = [
    "meta[property='product:price:amount']",
    "meta[property='og:price:amount']",
    "meta[itemprop='price']",
    ".price",
    "[class*='price']",
]


def _normalize_price(value: str):
    cleaned = re.sub(r"[^0-9.,]", "", value or "")
    if not cleaned:
        return None

    if cleaned.count(",") > 0 and cleaned.count(".") == 0:
        cleaned = cleaned.replace(",", ".")
    else:
        cleaned = cleaned.replace(",", "")

    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _extract_price(html: str):
    soup = BeautifulSoup(html, "html.parser")

    for selector in PRICE_SELECTORS:
        node = soup.select_one(selector)
        if not node:
            continue

        raw = node.get("content") or node.get_text(" ", strip=True)
        parsed = _normalize_price(raw)
        if parsed is not None:
            return parsed

    text = soup.get_text(" ", strip=True)
    match = re.search(r"(?:USD|\$|EUR|GBP|KES)?\s*([0-9]+(?:[.,][0-9]{1,2})?)", text)
    if match:
        return _normalize_price(match.group(1))

    return None


def _fetch_product_price(url: str):
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; CompetitorTracker/1.0)",
        "Accept-Language": "en-US,en;q=0.9",
    }
    response = requests.get(url, headers=headers, timeout=20)
    response.raise_for_status()
    return _extract_price(response.text)


def scrape_single_product(product: Product):
    try:
        price = _fetch_product_price(product.product_url)
        if price is None:
            return {
                "success": False,
                "product_id": product.id,
                "error": "price not found in page",
            }

        row = PriceHistory(product_id=product.id, price=price)
        db.session.add(row)
        db.session.commit()

        return {
            "success": True,
            "product_id": product.id,
            "product_name": product.product_name,
            "price": float(price),
            "collected_at": row.collected_at.isoformat(),
        }
    except Exception as exc:  # defensive for scraper variability
        db.session.rollback()
        return {
            "success": False,
            "product_id": product.id,
            "error": str(exc),
        }


def scrape_all_products():
    products = Product.query.all()
    results = [scrape_single_product(p) for p in products]

    return {
        "total_products": len(products),
        "successful": sum(1 for r in results if r["success"]),
        "failed": sum(1 for r in results if not r["success"]),
        "results": results,
    }


def main():
    from Backend.app import create_app

    app = create_app()
    with app.app_context():
        print(scrape_all_products())


if __name__ == "__main__":
    main()
