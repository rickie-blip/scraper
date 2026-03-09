# Competitor Price Tracker

## Backend (Flask API)
1. `python -m venv .venv`
2. `.venv\Scripts\activate`
3. `pip install -r requirements.txt`
4. Create PostgreSQL DB: `competitor_tracker`
5. Set env vars from `.env.example`
6. Run backend: `python app.py`

API base: `http://localhost:5000/api`

## Frontend (React)
1. `cd Frontend`
2. `npm install`
3. `npm run dev`

Frontend default URL: `http://localhost:5173`

Set API base if needed:
- PowerShell: `$env:VITE_API_BASE="http://localhost:5000/api"`

## Daily automation with Celery
1. Start Redis
2. In repo root run worker:
   `celery -A Backend.celery_worker:celery worker --loglevel=info`
3. Start scheduler:
   `celery -A Backend.celery_worker:celery beat --loglevel=info`

The task runs every day at 00:00 UTC.

## Manual scrape
- Single product: `POST /api/products/{id}/scrape`
- All products: `POST /api/scrape/run`
