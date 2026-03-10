import { NavLink, Route, Routes } from "react-router-dom";
import CollectionsPage from "./pages/CollectionsPage";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import TrackerPage from "./pages/TrackerPage";

export default function App() {
  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Scraper Control Center</p>
          <h1>ShopZetu Competitive Intelligence Suite</h1>
          <p className="subhead">
            Run live Shopify searches, scrape collections, and track competitor pricing from one console.
          </p>
        </div>
        <nav className="top-nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/collections">Collections</NavLink>
          <NavLink to="/tracker">Tracker</NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/tracker" element={<TrackerPage />} />
      </Routes>
    </div>
  );
}
