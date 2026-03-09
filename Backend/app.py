import os
from urllib.parse import urlparse

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import func, inspect, text

from Backend.database import db
from Backend.models import Competitor, PriceHistory, Product
from Scrapers.scraper import scrape_all_products, scrape_single_product


def normalize_website_url(value: str) -> str:
    website = (value or "").strip()
    if website and "://" not in website:
        website = f"https://{website}"
    return website


def is_valid_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def ensure_product_columns():
    inspector = inspect(db.engine)
    columns = {col["name"] for col in inspector.get_columns("products")}

    if "category" not in columns:
        db.session.execute(
            text("ALTER TABLE products ADD COLUMN category VARCHAR(120) NOT NULL DEFAULT 'General'")
        )
    db.session.commit()


def create_app():
    app = Flask(__name__)

    app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
        "DATABASE_URL",
        "sqlite:///competitor_tracker.db",
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    CORS(app, resources={r"/api/*": {"origins": "*"}})
    db.init_app(app)

    with app.app_context():
        db.create_all()
        ensure_product_columns()

    @app.get("/")
    def index():
        return jsonify(
            {
                "message": "Competitor Tracker backend is running",
                "api_base": "/api",
                "health": "/api/health",
                "frontend_dev_url": "http://localhost:5173",
            }
        )

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/api/competitors")
    def get_competitors():
        competitors = Competitor.query.order_by(Competitor.created_at.desc()).all()
        return jsonify(
            [
                {
                    "id": c.id,
                    "name": c.name,
                    "website": c.website,
                    "created_at": c.created_at.isoformat(),
                }
                for c in competitors
            ]
        )

    @app.post("/api/competitors")
    def add_competitor():
        data = request.get_json() or {}
        name = (data.get("name") or "").strip()
        website = normalize_website_url(data.get("website") or "")

        if not name or not website:
            return jsonify({"error": "name and website are required"}), 400
        if not is_valid_http_url(website):
            return jsonify({"error": "website must be a valid http/https URL"}), 400

        if Competitor.query.filter_by(name=name).first():
            return jsonify({"error": "competitor already exists"}), 409

        competitor = Competitor(name=name, website=website)
        db.session.add(competitor)
        db.session.commit()

        return jsonify({"id": competitor.id, "message": "competitor created"}), 201

    @app.get("/api/products")
    def get_products():
        products = Product.query.order_by(Product.id.desc()).all()
        return jsonify(
            [
                {
                    "id": p.id,
                    "product_name": p.product_name,
                    "category": p.category,
                    "product_url": p.product_url,
                    "competitor_id": p.competitor_id,
                    "competitor_name": p.competitor.name,
                    "latest_price": float(p.price_history[0].price) if p.price_history else None,
                    "latest_collected_at": p.price_history[0].collected_at.isoformat() if p.price_history else None,
                }
                for p in products
            ]
        )

    @app.post("/api/products")
    def add_product():
        data = request.get_json() or {}
        competitor_id = data.get("competitor_id")
        product_name = (data.get("product_name") or "").strip()
        category = (data.get("category") or "General").strip() or "General"
        product_url = (data.get("product_url") or "").strip()

        if not competitor_id or not product_name or not product_url:
            return jsonify({"error": "competitor_id, product_name and product_url are required"}), 400

        competitor = Competitor.query.get(competitor_id)
        if not competitor:
            return jsonify({"error": "competitor not found"}), 404

        if Product.query.filter_by(product_url=product_url).first():
            return jsonify({"error": "product url already tracked"}), 409

        product = Product(
            competitor_id=competitor.id,
            product_name=product_name,
            category=category,
            product_url=product_url,
        )
        db.session.add(product)
        db.session.commit()

        return jsonify({"id": product.id, "message": "product created"}), 201

    @app.get("/api/products/<int:product_id>/history")
    def product_history(product_id):
        product = Product.query.get_or_404(product_id)
        history = (
            PriceHistory.query.filter_by(product_id=product.id)
            .order_by(PriceHistory.collected_at.asc())
            .all()
        )

        return jsonify(
            {
                "product": {
                    "id": product.id,
                    "name": product.product_name,
                    "category": product.category,
                    "url": product.product_url,
                },
                "points": [
                    {
                        "id": row.id,
                        "price": float(row.price),
                        "collected_at": row.collected_at.isoformat(),
                    }
                    for row in history
                ],
            }
        )

    @app.post("/api/products/<int:product_id>/scrape")
    def scrape_product(product_id):
        product = Product.query.get_or_404(product_id)
        result = scrape_single_product(product)

        if not result["success"]:
            return jsonify(result), 422
        return jsonify(result)

    @app.post("/api/scrape/run")
    def scrape_all():
        return jsonify(scrape_all_products())

    @app.get("/api/dashboard/summary")
    def dashboard_summary():
        latest = PriceHistory.query.order_by(PriceHistory.collected_at.desc()).limit(15).all()
        return jsonify(
            {
                "total_competitors": Competitor.query.count(),
                "total_products": Product.query.count(),
                "latest_updates": [
                    {
                        "product_id": row.product_id,
                        "product_name": row.product.product_name,
                        "price": float(row.price),
                        "collected_at": row.collected_at.isoformat(),
                    }
                    for row in latest
                ],
            }
        )

    @app.get("/api/comparison")
    def comparison():
        base_competitor = (request.args.get("base_competitor") or "Vivo Fashion Group").strip()
        category = (request.args.get("category") or "").strip()
        if not category:
            return jsonify({"error": "category is required"}), 400

        query = Product.query.filter(func.lower(Product.category) == category.lower())
        products = query.all()

        by_competitor = {}
        for p in products:
            latest = p.price_history[0] if p.price_history else None
            if not latest:
                continue
            current = by_competitor.get(p.competitor.name)
            if not current:
                by_competitor[p.competitor.name] = {
                    "competitor": p.competitor.name,
                    "total_price": float(latest.price),
                    "items_count": 1,
                    "latest_collected_at": latest.collected_at,
                }
            else:
                current["total_price"] += float(latest.price)
                current["items_count"] += 1
                if latest.collected_at > current["latest_collected_at"]:
                    current["latest_collected_at"] = latest.collected_at

        rows = []
        for r in by_competitor.values():
            avg_price = round(r["total_price"] / r["items_count"], 2)
            rows.append(
                {
                    "competitor": r["competitor"],
                    "avg_price": avg_price,
                    "items_count": r["items_count"],
                    "collected_at": r["latest_collected_at"],
                }
            )
        rows.sort(key=lambda r: r["avg_price"])
        base_row = next((r for r in rows if r["competitor"].lower() == base_competitor.lower()), None)
        base_price = base_row["avg_price"] if base_row else None

        response_rows = []
        for r in rows:
            delta = None if base_price is None else round(r["avg_price"] - base_price, 2)
            delta_pct = None if base_price in (None, 0) else round(((r["avg_price"] - base_price) / base_price) * 100, 2)
            response_rows.append(
                {
                    "competitor": r["competitor"],
                    "avg_price": r["avg_price"],
                    "items_count": r["items_count"],
                    "collected_at": r["collected_at"].isoformat(),
                    "delta_vs_vivo": delta,
                    "delta_pct_vs_vivo": delta_pct,
                }
            )

        return jsonify(
            {
                "base_competitor": base_competitor,
                "base_found": base_row is not None,
                "category": category or None,
                "rows": response_rows,
            }
        )

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
