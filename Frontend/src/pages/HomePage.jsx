import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Welcome</h2>
          <p>Choose the workspace you want to use.</p>
        </div>
      </div>
      <div className="home-grid">
        <Link to="/search" className="home-card">
          <span className="home-title">Shopify Search Console</span>
          <span>Run the quick search routes for bodycons, bodysuits, and dresses.</span>
        </Link>
        <Link to="/collections" className="home-card">
          <span className="home-title">Collection Scrapers</span>
          <span>Pull full product lists from collection endpoints.</span>
        </Link>
        <Link to="/tracker" className="home-card">
          <span className="home-title">Competitor Tracker</span>
          <span>Manage competitors, products, scraping, and analytics.</span>
        </Link>
      </div>
    </div>
  );
}
