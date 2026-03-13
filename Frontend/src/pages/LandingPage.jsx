import { Link } from "react-router-dom";

export default function LandingPage() {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Welcome to ShopZetu Intelligence</h2>
          <p>Monitor competitors, compare pricing, and run targeted searches in minutes.</p>
        </div>
      </div>
      <div className="home-grid">
        <div className="card-block">
          <h3>Live Dashboard</h3>
          <p className="muted">View comparisons and price trends across competitors.</p>
          <Link to="/dashboard" className="btn btn-primary">
            Open Dashboard
          </Link>
        </div>
        <div className="card-block">
          <h3>Search Products</h3>
          <p className="muted">Run quick category searches and review results.</p>
          <Link to="/search" className="btn btn-outline-primary">
            Go to Search
          </Link>
        </div>
        <div className="card-block">
          <h3>Manage Competitors</h3>
          <p className="muted">Add and maintain competitor sources.</p>
          <Link to="/competitors" className="btn btn-outline-primary">
            Manage Competitors
          </Link>
        </div>
      </div>
    </div>
  );
}
