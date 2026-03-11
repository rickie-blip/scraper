import { NavLink, Route, Routes } from "react-router-dom";
import CollectionsPage from "./pages/CollectionsPage";
import CompetitorsPage from "./pages/CompetitorsPage";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import BotPage from "./pages/BotPage";
import ChatBotWidget from "./ChatBotWidget";

export default function App() {
  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Scraper Control Center</p>
          <h1>ShopZetu Competitive Intelligence Suite</h1>
          <p className="subhead">
            Run Real-time WEB searches, scrape collections, and track competitor pricing.
          </p>
        </div>
        <nav className="top-nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/collections">Collections</NavLink>
          <NavLink to="/competitors">Competitors</NavLink>
          <NavLink to="/bot">Bot</NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/competitors" element={<CompetitorsPage />} />
        <Route path="/bot" element={<BotPage />} />
      </Routes>
      <ChatBotWidget />
    </div>
  );
}
