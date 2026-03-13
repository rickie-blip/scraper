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
  const [priceSeries, setPriceSeries] = useState([]);
  const [priceLabels, setPriceLabels] = useState([]);
  const [priceSeriesLoading, setPriceSeriesLoading] = useState(false);
  const [priceSeriesError, setPriceSeriesError] = useState("");
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

  function normalizeName(value) {
    return String(value || "").trim().toLowerCase();
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
      if (saved.price_series) setPriceSeries(saved.price_series);
      if (saved.price_labels) setPriceLabels(saved.price_labels);
    }
    setComparisonHydrated(true);
  }, [comparison, category]);

  async function loadComparison() {
    setComparisonLoading(true);
    setComparisonError("");
    try {
      const result = await api.getComparison({ base_competitor: baseCompetitor, category });
      setComparison(result || { rows: [], failed: [] });
      setLastLoadedFilters({ category, base_competitor: baseCompetitor });
      savePersistedState("home", {
        category,
        base_competitor: baseCompetitor,
        comparison: result,
        price_series: priceSeries,
        price_labels: priceLabels,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      const saved = loadPersistedState("home");
      if (saved?.comparison) {
        setComparison(saved.comparison);
        setComparisonError(
          `${err.message || "Comparison failed."} Showing last saved results from ${
            saved.updated_at || "previous session"
          }.`
        );
      } else {
        setComparisonError(err.message);
      }
    } finally {
      setComparisonLoading(false);
    }
  }

  async function runSearch() {
    setSearchLoading(true);
    setSearchMessage("Search in progress. This can take a while, please be patient.");
    try {
      await loadComparison();
      await loadPriceSeries();
      setSearchMessage("Search completed. Chart updated.");
    } catch (err) {
      setSearchMessage(err.message || "Search failed.");
    } finally {
      setSearchLoading(false);
    }
  }

  async function loadPriceSeries() {
    setPriceSeriesLoading(true);
    setPriceSeriesError("");
    try {
      const products = await api.getProducts();
      const normalizedCategory = String(category || "").trim().toLowerCase();
      const filtered = Array.isArray(products)
        ? products.filter((product) => {
            if (!normalizedCategory) return true;
            return String(product.category || "").trim().toLowerCase() === normalizedCategory;
          })
        : [];
      const grouped = new Map();
      filtered.forEach((product) => {
        const brand = product.competitor_name || "Unknown";
        const price = Number(product.latest_price);
        if (!Number.isFinite(price)) return;
        if (!grouped.has(brand)) grouped.set(brand, []);
        grouped.get(brand).push(price);
      });
      let series = Array.from(grouped.entries()).map(([brand, prices]) => ({
        brand,
        data: prices.sort((a, b) => a - b).slice(0, 20),
      }));
      if (comparison?.rows?.length) {
        const allowed = new Set(
          comparison.rows.map((row) => normalizeName(row.competitor))
        );
        series = series.filter((item) => allowed.has(normalizeName(item.brand)));
      }
      const maxLen = series.reduce((max, item) => Math.max(max, item.data.length), 0);
      const labels = Array.from({ length: maxLen }, (_, idx) => `Product ${idx + 1}`);
      setPriceLabels(labels);
      setPriceSeries(series);
      savePersistedState("home", {
        category,
        base_competitor: baseCompetitor,
        comparison,
        price_series: series,
        price_labels: labels,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      const saved = loadPersistedState("home");
      if (saved?.price_series && saved?.price_labels) {
        setPriceSeries(saved.price_series);
        setPriceLabels(saved.price_labels);
        setPriceSeriesError(
          `${err.message || "Failed to load price comparison data."} Showing last saved results from ${
            saved.updated_at || "previous session"
          }.`
        );
      } else {
        setPriceSeriesError(err.message || "Failed to load price comparison data.");
        setPriceLabels([]);
        setPriceSeries([]);
      }
    } finally {
      setPriceSeriesLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Welcome</h2>
          <p>Choose What You Want to View.</p>
        </div>
      </div>
      <div className="home-grid">
        <Link to="/search" className="home-card">
          <span className="home-title">Shopify Search Console</span>
          <span>Run the quick search routes for Comparison of Products.</span>
        </Link>
        
        <Link to="/competitors" className="home-card">
          <span className="home-title">Competitor Tracker</span>
          <span>Competitor List.</span>
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
            className="btn btn-outline-primary btn-with-spinner"
            onClick={runSearch}
            disabled={searchLoading}
          >
            {searchLoading && <span className="btn-spinner" aria-hidden="true" />}
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
              className="btn btn-primary btn-with-spinner"
              type="button"
              onClick={() => {
                loadComparison();
                loadPriceSeries();
              }}
              disabled={comparisonLoading}
            >
              {comparisonLoading && <span className="btn-spinner" aria-hidden="true" />}
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
            <h3>Price Comparison by Brand</h3>
            <p>First 20 products per brand sorted by price.</p>
          </div>
        </div>
        <div className="mt-3">
          {priceSeriesError && <div className="alert alert-warning mt-3">{priceSeriesError}</div>}
          {priceSeriesLoading ? (
            <div className="text-muted">Loading price comparison...</div>
          ) : (
            <BrandHistoryChart
              labels={priceLabels}
              series={priceSeries}
              currency={chartCurrency}
            />
          )}
        </div>
      </div>
    </div>
  );
}
