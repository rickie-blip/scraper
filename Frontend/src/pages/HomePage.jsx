import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { loadPersistedState, savePersistedState } from "../utils/persist";
import AverageComparisonChart from "../AverageComparisonChart";
import BrandHistoryChart from "../BrandHistoryChart";
import { flattenCategoryOptions } from "../categoryData";

export default function HomePage() {
  const [competitors, setCompetitors] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  const [baseCompetitor, setBaseCompetitor] = useState("");
  const [category, setCategory] = useState("dresses");
  const [comparisonHydrated, setComparisonHydrated] = useState(false);
  const [lastLoadedFilters, setLastLoadedFilters] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [brandHistory, setBrandHistory] = useState([]);
  const [brandHistoryLabels, setBrandHistoryLabels] = useState([]);
  const [brandHistoryLoading, setBrandHistoryLoading] = useState(false);
  const [brandHistoryError, setBrandHistoryError] = useState("");
  const chartCurrency = comparison?.base_currency || "KES";
  function normalizeCurrency(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "KSH") return "KES";
    return /^[A-Z]{3}$/.test(normalized) ? normalized : "KES";
  }

  function formatPrice(value, currency) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    const safeCurrency = normalizeCurrency(currency);
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: safeCurrency,
    }).format(num);
  }

  const categoryOptions = useMemo(() => {
    const flattened = flattenCategoryOptions();
    const grouped = new Map();
    flattened.forEach((item) => {
      if (!grouped.has(item.group)) grouped.set(item.group, []);
      grouped.get(item.group).push(item);
    });
    return Array.from(grouped.entries());
  }, []);

  useEffect(() => {
    let active = true;
    api
      .getCompetitors()
      .then((data) => {
        if (!active) return;
        setCompetitors(data);
      })
      .catch((err) => {
        if (!active) return;
        setComparisonError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadBrandHistory() {
    setBrandHistoryLoading(true);
    setBrandHistoryError("");
    try {
      const data = await api.getBrandHistory({ category });
      setBrandHistoryLabels(data.labels || []);
      setBrandHistory(data.series || []);
    } catch (err) {
      setBrandHistoryError(err.message);
      setBrandHistoryLabels([]);
      setBrandHistory([]);
    } finally {
      setBrandHistoryLoading(false);
    }
  }

  useEffect(() => {
    const saved = loadPersistedState("home");
    if (saved && !comparison) {
      if (saved.category) setCategory(saved.category);
      if (saved.base_competitor) setBaseCompetitor(saved.base_competitor);
      if (saved.comparison) {
        setComparison(saved.comparison);
        setLastLoadedFilters({
          category: saved.category || category,
          base_competitor: saved.base_competitor || "",
        });
      }
    }
    setComparisonHydrated(true);
  }, [comparison, category]);

  async function loadComparison({ persist = false } = {}) {
    setComparisonLoading(true);
    setComparisonError("");
    try {
      if (!competitors.length) {
        setComparison({ rows: [], failed: [] });
        return;
      }

      const requests = competitors.map((competitor) =>
        api.searchCompetitor(competitor.id, category, { persist })
      );
      const results = await Promise.allSettled(requests);
      const rows = [];
      const failed = [];

      results.forEach((result, index) => {
        const competitor = competitors[index];
        if (result.status !== "fulfilled") {
          failed.push(competitor?.name || `Competitor ${index + 1}`);
          rows.push({
            competitor: competitor?.name || `Competitor ${index + 1}`,
            items_count: 0,
            avg_price: null,
            delta_vs_vivo: null,
            delta_pct_vs_vivo: null,
          });
          return;
        }

        const items = result.value?.data || [];
        const limitedItems = items.slice(0, 20);
        const prices = limitedItems
          .map((item) => Number(item.price))
          .filter((value) => Number.isFinite(value));
        const avg =
          prices.length > 0
            ? prices.reduce((sum, value) => sum + value, 0) / prices.length
            : null;
        rows.push({
          competitor: competitor?.name || `Competitor ${index + 1}`,
          items_count: limitedItems.length,
          avg_price: avg != null ? Number(avg.toFixed(2)) : null,
          delta_vs_vivo: null,
          delta_pct_vs_vivo: null,
        });
      });

      if (baseCompetitor) {
        const baseRow = rows.find((row) => row.competitor === baseCompetitor);
        const baseAvg = baseRow?.avg_price;
        if (baseAvg != null) {
          rows.forEach((row) => {
            if (row.avg_price == null) return;
            const delta = row.avg_price - baseAvg;
            row.delta_vs_vivo = Number(delta.toFixed(2));
            row.delta_pct_vs_vivo =
              baseAvg !== 0 ? Number(((delta / baseAvg) * 100).toFixed(2)) : null;
          });
        }
      }

      const nextComparison = { rows, failed, base_currency: "KES" };
      setComparison(nextComparison);
      setLastLoadedFilters({ category, base_competitor: baseCompetitor });
      savePersistedState("home", {
        category,
        base_competitor: baseCompetitor,
        comparison: nextComparison,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      setComparisonError(err.message);
    } finally {
      setComparisonLoading(false);
    }
  }

  useEffect(() => {
    if (!comparisonHydrated || !category) return;
    if (
      lastLoadedFilters &&
      lastLoadedFilters.category === category &&
      lastLoadedFilters.base_competitor === baseCompetitor
    ) {
      return;
    }
    loadComparison();
  }, [category, baseCompetitor, comparisonHydrated, lastLoadedFilters]);

  async function runSearch() {
    setSearchLoading(true);
    setSearchMessage("");
    try {
      await loadComparison({ persist: true });
      setSearchMessage("Search completed. Chart updated.");
    } catch (err) {
      setSearchMessage(err.message || "Search failed.");
    } finally {
      setSearchLoading(false);
    }
  }

  useEffect(() => {
    loadBrandHistory();
  }, [category]);

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
        <Link to="/competitors" className="home-card">
          <span className="home-title">Competitor Tracker</span>
          <span>Manage competitors, products, scraping, and analytics.</span>
        </Link>
      </div>

      <div className="card-block mt-4">
        <div className="panel-head">
          <div>
            <h3>Quick Actions</h3>
            <p>Jump straight to the most common tasks.</p>
          </div>
        </div>
        <div className="grid-row">
          <button
            type="button"
            className="btn btn-outline-primary"
            onClick={runSearch}
            disabled={searchLoading}
          >
            {searchLoading ? "Running Search..." : "Run Category Search"}
          </button>
          <Link to="/search" className="btn btn-outline-primary">
            Search Category
          </Link>
          <Link to="/competitors" className="btn btn-outline-primary">
            Add Competitor
          </Link>
        </div>
        {searchMessage && <div className="alert alert-info mt-3">{searchMessage}</div>}
      </div>

      <div className="card-block mt-4">
        <div className="panel-head">
          <div>
            <h3>Category Comparison</h3>
            <p>Average price per competitor and overall category average.</p>
          </div>
        </div>
        <div className="grid-row">
          <select
            className="form-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categoryOptions.map(([groupLabel, options]) => (
              <optgroup key={groupLabel} label={groupLabel}>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            className="form-select"
            value={baseCompetitor}
            onChange={(e) => setBaseCompetitor(e.target.value)}
          >
            <option value="">All competitors</option>
            {competitors.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => loadComparison({ persist: true })}
            disabled={comparisonLoading}
          >
            {comparisonLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {comparisonError && <div className="alert alert-warning mt-3">{comparisonError}</div>}

        {comparison && (
          <div className="mt-3">
            <AverageComparisonChart rows={comparison.rows || []} currency={chartCurrency} />
            <div className="table-responsive mt-3">
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>Competitor</th>
                    <th>Items</th>
                    <th>Average Price</th>
                    <th>Average Price</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows?.map((row) => (
                    <tr key={row.competitor}>
                      <td>{row.competitor}</td>
                      <td>{row.items_count}</td>
                      <td>{formatPrice(row.avg_price, chartCurrency)}</td>
                      <td>{formatPrice(row.avg_price, chartCurrency)}</td>
                    </tr>
                  ))}
                  {!comparison.rows?.length && (
                    <tr>
                      <td colSpan="4" className="text-muted">
                        No data for the selected category.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {comparison.failed?.length > 0 && (
              <div className="alert alert-warning mt-2">
                Failed searches: {comparison.failed.join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card-block mt-4">
        <div className="panel-head">
          <div>
            <h3>Brand Price History</h3>
            <p>Average price trend per brand for the selected category.</p>
          </div>
        </div>
        <div className="grid-row">
          <button
            className="btn btn-outline-primary"
            type="button"
            onClick={loadBrandHistory}
            disabled={brandHistoryLoading}
          >
            {brandHistoryLoading ? "Loading..." : "Refresh History"}
          </button>
        </div>

        {brandHistoryError && <div className="alert alert-warning mt-3">{brandHistoryError}</div>}

        <div className="mt-3">
          <BrandHistoryChart
            labels={brandHistoryLabels}
            series={brandHistory}
            currency={chartCurrency}
          />
        </div>
      </div>
    </div>
  );
}
