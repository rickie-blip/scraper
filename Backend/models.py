from datetime import datetime

from Backend.database import db


class Competitor(db.Model):
    __tablename__ = "competitors"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, unique=True)
    website = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    products = db.relationship("Product", back_populates="competitor", cascade="all, delete-orphan")


class Product(db.Model):
    __tablename__ = "products"

    id = db.Column(db.Integer, primary_key=True)
    competitor_id = db.Column(db.Integer, db.ForeignKey("competitors.id"), nullable=False)
    product_name = db.Column(db.String(255), nullable=False)
    category = db.Column(db.String(120), nullable=False, default="General")
    product_url = db.Column(db.String(1200), nullable=False, unique=True)

    competitor = db.relationship("Competitor", back_populates="products")
    price_history = db.relationship(
        "PriceHistory",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="desc(PriceHistory.collected_at)",
    )


class PriceHistory(db.Model):
    __tablename__ = "price_history"

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False, index=True)
    price = db.Column(db.Numeric(12, 2), nullable=False)
    collected_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    product = db.relationship("Product", back_populates="price_history")
