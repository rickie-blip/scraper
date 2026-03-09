import os

from celery import Celery
from celery.schedules import crontab

from Backend.app import create_app
from Scrapers.scraper import scrape_all_products


flask_app = create_app()

celery = Celery(
    "competitor_tracker",
    broker=os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"),
    backend=os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1"),
)


class FlaskContextTask(celery.Task):
    def __call__(self, *args, **kwargs):
        with flask_app.app_context():
            return self.run(*args, **kwargs)


celery.Task = FlaskContextTask
celery.conf.beat_schedule = {
    "daily-scrape": {
        "task": "Backend.celery_worker.run_daily_scrape",
        "schedule": crontab(hour=0, minute=0),
    }
}
celery.conf.timezone = "UTC"


@celery.task(name="Backend.celery_worker.run_daily_scrape")
def run_daily_scrape():
    return scrape_all_products()
