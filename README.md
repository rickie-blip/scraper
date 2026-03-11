# System Overview

This project is a single system with a frontend app and a backend service working together to:
- Manage competitors and product data
- Search competitor catalogs
- Scrape collections
- Provide a chatbot UI that can route to the backend

## How It Works

### Frontend
The frontend presents four main workspaces:
- **Search Console**: Runs category searches against saved competitors.
- **Collection Scrapers**: Scrapes full collection URLs and exports results.
- **Competitor Tracker**: Manages competitors, products, history, and comparisons.
- **Chatbot**: Sends messages to the backend to run the Langflow proxy.

The category dropdown in the Search Console contains nested subcategories (Dresses, Skirts, Bottoms, Tops, Innerwear) and writes the selected value into the search query.

### Backend
The backend provides a REST API for:
- Competitors, products, and history
- Collection scraping
- Langflow proxy calls

Data is stored in `Backend/data/store.json`.

### Scraping
All scraping is unified in `Backend/scraper.js`:
- `auto` mode chooses the best method based on the URL
- `shopify-collection` uses Shopify collection JSON
- `shopify-page` collects product links and reads `.js` product data
- `generic` uses HTML extraction
- `puma` uses page parsing tailored for PUMA

The backend routes that scrape collections use this unified scraper.

## Key API Endpoints

- `GET /api/health`
- `GET /api/competitors`
- `POST /api/competitors`
- `PUT /api/competitors/:id`
- `DELETE /api/competitors/:id`
- `GET /api/competitors/:id/search?q=...`
- `GET /api/competitors/:id/presets`
- `GET /api/collections/scrape?url=...&currency=...`
- `POST /api/langflow/run`

## CLI Scraper Usage

```bash
node scraper.js --url "https://example.com/collections/dresses" --mode auto --format json
```

Optional flags:
- `--mode` (`auto`, `shopify-collection`, `shopify-page`, `generic`, `puma`)
- `--format` (`json` or `csv`)
- `--output` (custom file name)
- `--currency` (adds currency field)
- `--email` (send output file to recipients)

Email requires:
- `SENDER_EMAIL`
- `SENDER_PWD`
- `SCRAPER_EMAIL_RECIPIENTS` (comma-separated)
