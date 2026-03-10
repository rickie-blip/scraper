import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import PriceChart from "./PriceChart";

const SEARCH_TARGETS = [
  { key: "vivo-bodycons", label: "Vivo • Bodycons", defaultQuery: "bodycons", run: api.searchVivoBodycons },
  { key: "nalani-bodycons", label: "Nalani • Bodycons", defaultQuery: "bodycons", run: api.searchNalaniBodycons },
  { key: "neviive-bodycons", label: "Neviive • Bodycons", defaultQuery: "bodycons", run: api.searchNeviiveBodycons },
  { key: "dirac-bodycons", label: "Dirac • Bodycons", defaultQuery: "bodycons", run: api.searchDiracBodycons },
  { key: "vivo-bodysuits", label: "Vivo • Bodysuits", defaultQuery: "bodysuits", run: api.searchVivoBodysuits },
  { key: "nalani-bodysuits", label: "Nalani • Bodysuits", defaultQuery: "bodysuits", run: api.searchNalaniBodysuits },
  { key: "neviive-bodysuits", label: "Neviive • Bodysuits", defaultQuery: "bodysuits", run: api.searchNeviiveBodysuits },
  { key: "dirac-bodysuits", label: "Dirac • Bodysuits", defaultQuery: "bodysuits", run: api.searchDiracBodysuits },
  { key: "vivo-dresses", label: "Vivo • Dresses", defaultQuery: "dresses", run: api.searchVivoDresses },
  { key: "nalani-dresses", label: "Nalani • Dresses", defaultQuery: "dresses", run: api.searchNalaniDresses },
  { key: "neviive-dresses", label: "Neviive • Dresses", defaultQuery: "dresses", run: api.searchNeviiveDresses },
  { key: "dirac-dresses", label: "Dirac • Dresses", defaultQuery: "dresses", run: api.searchDiracDresses },
];

const COLLECTION_TARGETS = [
  {
    key: "vivo-dresses-collection",
    label: "Vivo Dresses Collection (Shopzetu)",
    defaultUrl: "https://pay.shopzetu.com/collections/dresses",
    run: api.scrapeVivoDressesCollection,
  },
  {
    key: "neviive-dresses-collection",
    label: "Neviive Dresses Collection",
    defaultUrl: "https://www.neviive.com/collections/dresses",
    run: api.scrapeNeviiveDressesCollection,
  },
  {
    key: "ikojn-dresses",
    label: "Ikojn Dresses Collection",
    defaultUrl: "https://www.ikojn.com/collections/dresses",
    run: api.ikojnDresses,
  },
  {
    key: "nalani-dresses-collection",
    label: "Nalani Dresses Collection",
    defaultUrl: "https://nalaniwomen.com/collections/dresses",
    run: api.nalaniDressesCollection,
  },
];

const SCRIPT_CATALOG = [
  "universal_scraper.js",
  "scrape_api.js",
  "scrape_graphql.js",
  "scrape_puppeteer.js",
  "scrape_puma-2025.js",
  "scrape_puma-2026.js",
  "scrape_improved.js",
  "scrape_intercept.js",
  "scrape_etam.js",
  "scrape-puma.js",
  "scrap_collection_json.js",
  "scrap_ecommerce_csv.js",
  "scrap_ecommerce_json.js",
  "scrap_puma_ecommerce.js",
  "scrap_nalani_products.js",
  "scrap_vivo_products.js",
  "scrap_shopify_collections-TEST.js",
  "puma.py",
  "run_scraper.sh",
];

export default function App() {
  const [backendOk, setBackendOk] = useState(null);

  const [summary, setSummary] = useState({ total_competitors: 0, total_products: 0, latest_updates: [] });
  const [competitors, setCompetitors] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [history, setHistory] = useState([]);
  const [historyProductName, setHistoryProductName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [competitorForm, setCompetitorForm] = useState({ name: "", website: "" });
  const [productForm, setProductForm] = useState({
    competitor_id: "",
    product_name: "",
    category: "General",
    product_url: "",
  });
  const [comparisonForm, setComparisonForm] = useState({
    base_competitor: "Vivo Fashion Group",
    category: "",
  });
  const [comparison, setComparison] = useState(null);

  const [liveForm, setLiveForm] = useState({
    product_name: "",
    base_competitor: "Vivo Fashion Group",
  });
  const [liveResult, setLiveResult] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);

  const [searchTarget, setSearchTarget] = useState(SEARCH_TARGETS[0].key);
  const [searchQuery, setSearchQuery] = useState(SEARCH_TARGETS[0].defaultQuery);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState("");

  const [collectionTarget, setCollectionTarget] = useState(COLLECTION_TARGETS[0].key);
  const [collectionUrl, setCollectionUrl] = useState(COLLECTION_TARGETS[0].defaultUrl);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionResult, setCollectionResult] = useState(null);
  const [collectionError, setCollectionError] = useState("");

  const sortedUpdates = useMemo(() => summary.latest_updates || [], [summary]);
  const categoryOptions = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products]
  );
  const competitorNames = useMemo(
    () => competitors.map((c) => c.name).filter(Boolean).sort(),
    [competitors]
  );
  const canAddProduct = competitors.length > 0;

  function normalizeWebsiteUrl(value) {
    const trimmed = (value || "").trim();
    if (!trimmed) return "";
    return trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  }

  function isValidWebsiteUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function formatPrice(value) {
    if (value == null || value === "") return "-";
    return typeof value === "number" ? `$${value}` : String(value);
  }

  function getSearchTarget() {
    return SEARCH_TARGETS.find((t) => t.key === searchTarget) || SEARCH_TARGETS[0];
  }

  function getCollectionTarget() {
    return COLLECTION_TARGETS.find((t) => t.key === collectionTarget) || COLLECTION_TARGETS[0];
  }

  async function loadTracker() {
    setLoading(true);
    setError("");
    try {
      const [s, c, p] = await Promise.all([api.getSummary(), api.getCompetitors(), api.getProducts()]);
      setSummary(s);
      setCompetitors(c);
      setProducts(p);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api
      .health()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

  useEffect(() => {
    loadTracker();
  }, []);

  useEffect(() => {
    if (!selectedProductId) {
      setHistory([]);
      setHistoryProductName("");
      return;
    }

    api
      .getHistory(selectedProductId)
      .then((res) => {
        setHistory(res.points || []);
        setHistoryProductName(res.product?.product_name || "");
      })
      .catch((err) => setError(err.message));
  }, [selectedProductId]);

  useEffect(() => {
    const target = getSearchTarget();
    setSearchQuery(target.defaultQuery);
    setSearchResult(null);
    setSearchError("");
  }, [searchTarget]);

  useEffect(() => {
    const target = getCollectionTarget();
    setCollectionUrl(target.defaultUrl);
    setCollectionResult(null);
    setCollectionError("");
  }, [collectionTarget]);

  async function onAddCompetitor(e) {
    e.preventDefault();
    setError("");
    try {
      const website = normalizeWebsiteUrl(competitorForm.website);
      if (!isValidWebsiteUrl(website)) {
        setError("Please enter a valid website URL.");
        return;
      }
      await api.addCompetitor({ ...competitorForm, website });
      setCompetitorForm({ name: "", website: "" });
      await loadTracker();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onAddProduct(e) {
    e.preventDefault();
    setError("");
    try {
      await api.addProduct({
        ...productForm,
        competitor_id: Number(productForm.competitor_id),
      });
      setProductForm({ competitor_id: "", product_name: "", category: "General", product_url: "" });
      await loadTracker();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onScrapeProduct(productId) {
    setError("");
    try {
      await api.scrapeProduct(productId);
      await loadTracker();
      if (String(selectedProductId) === String(productId)) {
        const res = await api.getHistory(productId);
        setHistory(res.points || []);
        setHistoryProductName(res.product?.product_name || "");
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function onScrapeAll() {
    setError("");
    try {
      await api.scrapeAll();
      await loadTracker();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onRunComparison(e) {
    e.preventDefault();
    setError("");
    try {
      const result = await api.getComparison(comparisonForm);
      setComparison(result);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onLiveCompare(e) {
    e.preventDefault();
    setError("");
    setLiveLoading(true);
    try {
      const result = await api.liveCompare(liveForm);
      setLiveResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLiveLoading(false);
    }
  }

  async function onSearchSubmit(e) {
    e.preventDefault();
    setSearchLoading(true);
    setSearchError("");
    setSearchResult(null);
    try {
      const target = getSearchTarget();
      const res = await target.run(searchQuery);
      setSearchResult(res);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearchLoading(false);
    }
  }

  async function onCollectionSubmit(e) {
    e.preventDefault();
    setCollectionLoading(true);
    setCollectionError("");
    setCollectionResult(null);
    try {
      const target = getCollectionTarget();
      const res = await target.run(collectionUrl);
      setCollectionResult(res);
    } catch (err) {
      setCollectionError(err.message);
    } finally {
      setCollectionLoading(false);
    }
  }

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
        <div className="status-pill">
          <span className={backendOk ? "dot ok" : backendOk === false ? "dot err" : "dot"} />
          <span>
            {backendOk === null && "Checking backend..."}
            {backendOk === true && "Backend online"}
            {backendOk === false && "Backend offline"}
          </span>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <div className="alert alert-info">Loading tracker data...</div>}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Quick Shopify Search</h2>
            <p>Directly calls the search suggest endpoints exposed in the backend.</p>
          </div>
        </div>
        <form className="grid-row" onSubmit={onSearchSubmit}>
          <select
            className="form-select"
            value={searchTarget}
            onChange={(e) => setSearchTarget(e.target.value)}
          >
            {SEARCH_TARGETS.map((target) => (
              <option key={target.key} value={target.key}>
                {target.label}
              </option>
            ))}
          </select>
          <input
            className="form-control"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search keyword"
          />
          <button className="btn btn-primary" type="submit" disabled={searchLoading}>
            {searchLoading ? "Searching..." : "Search"}
          </button>
        </form>
        {searchError && <div className="alert alert-warning mt-2">{searchError}</div>}
        {searchResult && (
          <div className="table-responsive mt-3">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Product</th>
                  <th>Brand</th>
                  <th>Price</th>
                  <th>URL</th>
                </tr>
              </thead>
              <tbody>
                {searchResult.data?.map((item, idx) => (
                  <tr key={`${item.url}-${idx}`}>
                    <td>
                      {item.image ? <img className="thumb" src={item.image} alt={item.title} /> : "-"}
                    </td>
                    <td>{item.title}</td>
                    <td>{item.brand}</td>
                    <td>{formatPrice(item.price)}</td>
                    <td>
                      {item.url ? (
                        <a href={item.url} rel="noreferrer" target="_blank">
                          Open
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
                {!searchResult.data?.length && (
                  <tr>
                    <td className="text-muted" colSpan="5">
                      No results returned.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Collection Scrapers</h2>
            <p>Uses the backend collection endpoints to pull full product lists.</p>
          </div>
        </div>
        <form className="grid-row" onSubmit={onCollectionSubmit}>
          <select
            className="form-select"
            value={collectionTarget}
            onChange={(e) => setCollectionTarget(e.target.value)}
          >
            {COLLECTION_TARGETS.map((target) => (
              <option key={target.key} value={target.key}>
                {target.label}
              </option>
            ))}
          </select>
          <input
            className="form-control"
            value={collectionUrl}
            onChange={(e) => setCollectionUrl(e.target.value)}
            placeholder="Collection URL (optional)"
          />
          <button className="btn btn-primary" type="submit" disabled={collectionLoading}>
            {collectionLoading ? "Running..." : "Scrape Collection"}
          </button>
        </form>
        {collectionError && <div className="alert alert-warning mt-2">{collectionError}</div>}
        {collectionResult && (
          <div className="table-responsive mt-3">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Images</th>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Compare At</th>
                  <th>URL</th>
                </tr>
              </thead>
              <tbody>
                {collectionResult.data?.map((item, idx) => (
                  <tr key={`${item.url}-${idx}`}>
                    <td>
                      {item.images?.length ? (
                        <img className="thumb" src={item.images[0]} alt={item.title} />
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{item.title}</td>
                    <td>{formatPrice(item.price)}</td>
                    <td>{formatPrice(item.compareAtPrice)}</td>
                    <td>
                      {item.url ? (
                        <a href={item.url} rel="noreferrer" target="_blank">
                          Open
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
                {!collectionResult.data?.length && (
                  <tr>
                    <td className="text-muted" colSpan="5">
                      No products returned.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Competitor Price Tracker</h2>
            <p>Persistent tracking using the backend storage API.</p>
          </div>
          <button className="btn btn-outline-primary" onClick={onScrapeAll}>
            Run Daily Scrape Now
          </button>
        </div>

        <div className="metrics">
          <div className="metric-card">
            <span>Total Competitors</span>
            <strong>{summary.total_competitors}</strong>
          </div>
          <div className="metric-card">
            <span>Total Tracked Products</span>
            <strong>{summary.total_products}</strong>
          </div>
        </div>

        <div className="split">
          <div className="card-block">
            <h5>Add Competitor</h5>
            <form onSubmit={onAddCompetitor}>
              <label className="form-label mb-1">Competitor Name</label>
              <input
                className="form-control mb-2"
                placeholder="e.g. Fashion Nova"
                value={competitorForm.name}
                onChange={(e) => setCompetitorForm((s) => ({ ...s, name: e.target.value }))}
                required
              />
              <label className="form-label mb-1">Website URL</label>
              <input
                className="form-control mb-2"
                placeholder="e.g. www.example.com"
                value={competitorForm.website}
                onChange={(e) => setCompetitorForm((s) => ({ ...s, website: e.target.value }))}
                required
              />
              <button className="btn btn-primary" type="submit">Add Competitor</button>
            </form>
          </div>

          <div className="card-block">
            <h5>Add Product</h5>
            <form onSubmit={onAddProduct} className="grid-row">
              <select
                className="form-select"
                value={productForm.competitor_id}
                onChange={(e) => setProductForm((s) => ({ ...s, competitor_id: e.target.value }))}
                required
                disabled={!canAddProduct}
              >
                <option value="">Competitor</option>
                {competitors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className="form-control"
                placeholder="Store name"
                value={productForm.product_name}
                onChange={(e) => setProductForm((s) => ({ ...s, product_name: e.target.value }))}
                required
              />
              <input
                className="form-control"
                placeholder="Category"
                value={productForm.category}
                onChange={(e) => setProductForm((s) => ({ ...s, category: e.target.value }))}
                required
              />
              <input
                className="form-control"
                placeholder="Product URL"
                value={productForm.product_url}
                onChange={(e) => setProductForm((s) => ({ ...s, product_url: e.target.value }))}
                required
              />
              <button className="btn btn-primary" type="submit" disabled={!canAddProduct}>
                Add
              </button>
            </form>
            {!canAddProduct && <div className="text-muted mt-2">Add a competitor before creating products.</div>}
          </div>
        </div>

        <div className="table-responsive mt-3">
          <table className="table table-sm align-middle">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Competitor</th>
                <th>Latest Price</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.product_name}</td>
                  <td>{p.category}</td>
                  <td>{p.competitor_name}</td>
                  <td>{formatPrice(p.latest_price)}</td>
                  <td className="text-end">
                    <button className="btn btn-outline-secondary btn-sm me-2" onClick={() => setSelectedProductId(String(p.id))}>
                      View Chart
                    </button>
                    <button className="btn btn-outline-primary btn-sm" onClick={() => onScrapeProduct(p.id)}>
                      Scrape Now
                    </button>
                  </td>
                </tr>
              ))}
              {!products.length && (
                <tr>
                  <td colSpan="5" className="text-muted">
                    No products tracked yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="split mt-3">
          <div className="card-block">
            <h5>Live Compare (Shopify Suggest)</h5>
            <form className="grid-row" onSubmit={onLiveCompare}>
              <input
                className="form-control"
                placeholder="Product name from Vivo Shopify"
                value={liveForm.product_name}
                onChange={(e) => setLiveForm((s) => ({ ...s, product_name: e.target.value }))}
                required
              />
              <input
                className="form-control"
                placeholder="Base competitor"
                list="competitor-names"
                value={liveForm.base_competitor}
                onChange={(e) => setLiveForm((s) => ({ ...s, base_competitor: e.target.value }))}
                required
              />
              <button className="btn btn-primary" disabled={liveLoading || !competitors.length} type="submit">
                {liveLoading ? "Searching..." : "Pull and Compare"}
              </button>
            </form>
            {liveResult && (
              <div className="table-responsive mt-2">
                <table className="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th>Competitor</th>
                      <th>Matched Product</th>
                      <th>Price</th>
                      <th>Delta vs Vivo</th>
                      <th>Delta %</th>
                      <th>URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveResult.matches.map((row) => (
                      <tr key={row.competitor}>
                        <td>{row.competitor}</td>
                        <td>{row.product_name}</td>
                        <td>{formatPrice(row.price)}</td>
                        <td className={row.delta_vs_vivo > 0 ? "text-danger" : row.delta_vs_vivo < 0 ? "text-success" : ""}>
                          {row.delta_vs_vivo ?? "-"}
                        </td>
                        <td className={row.delta_pct_vs_vivo > 0 ? "text-danger" : row.delta_pct_vs_vivo < 0 ? "text-success" : ""}>
                          {row.delta_pct_vs_vivo != null ? `${row.delta_pct_vs_vivo}%` : "-"}
                        </td>
                        <td>
                          {row.product_url ? (
                            <a href={row.product_url} rel="noreferrer" target="_blank">Open</a>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                    {!liveResult.matches.length && (
                      <tr>
                        <td className="text-muted" colSpan="6">No matches found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card-block">
            <h5>Category Comparison</h5>
            <form className="grid-row" onSubmit={onRunComparison}>
              <input
                className="form-control"
                value={comparisonForm.base_competitor}
                onChange={(e) => setComparisonForm((s) => ({ ...s, base_competitor: e.target.value }))}
                placeholder="Base competitor"
                list="competitor-names"
                required
              />
              <select
                className="form-select"
                value={comparisonForm.category}
                onChange={(e) => setComparisonForm((s) => ({ ...s, category: e.target.value }))}
                required
              >
                <option value="">Select category</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button className="btn btn-primary" type="submit">Compare</button>
            </form>
            {comparison && (
              <div className="table-responsive mt-2">
                <table className="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th>Competitor</th>
                      <th>Items Count</th>
                      <th>Category Avg Price</th>
                      <th>Delta vs Vivo</th>
                      <th>Delta %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map((row) => (
                      <tr key={row.competitor}>
                        <td>{row.competitor}</td>
                        <td>{row.items_count}</td>
                        <td>{formatPrice(row.avg_price)}</td>
                        <td className={row.delta_vs_vivo > 0 ? "text-danger" : row.delta_vs_vivo < 0 ? "text-success" : ""}>
                          {row.delta_vs_vivo ?? "-"}
                        </td>
                        <td className={row.delta_pct_vs_vivo > 0 ? "text-danger" : row.delta_pct_vs_vivo < 0 ? "text-success" : ""}>
                          {row.delta_pct_vs_vivo != null ? `${row.delta_pct_vs_vivo}%` : "-"}
                        </td>
                      </tr>
                    ))}
                    {!comparison.rows.length && (
                      <tr>
                        <td colSpan="5" className="text-muted">No comparable priced products found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="split mt-3">
          <div className="card-block">
            <h5>Price History</h5>
            <PriceChart points={history} productName={historyProductName} />
          </div>
          <div className="card-block">
            <h5>Latest Updates</h5>
            <ul className="list-group list-group-flush">
              {sortedUpdates.map((u, idx) => (
                <li className="list-group-item px-0" key={`${u.product_id}-${idx}`}>
                  <div><strong>{u.product_name}</strong></div>
                  <div>{formatPrice(u.price)} at {new Date(u.collected_at).toLocaleString()}</div>
                </li>
              ))}
              {!sortedUpdates.length && <li className="list-group-item px-0 text-muted">No updates yet.</li>}
            </ul>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Backend Script Library</h2>
            <p>Standalone scripts in the backend folder (not exposed as HTTP routes).</p>
          </div>
        </div>
        <div className="script-grid">
          {SCRIPT_CATALOG.map((script) => (
            <div className="script-card" key={script}>
              <strong>{script}</strong>
              <span>Run from the Backend folder.</span>
            </div>
          ))}
        </div>
      </section>

      <datalist id="competitor-names">
        {competitorNames.map((name) => (
          <option value={name} key={name} />
        ))}
      </datalist>
    </div>
  );
}
