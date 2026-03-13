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

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  price NUMERIC,
  collected_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dashboard_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
