import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import PriceChart from "./PriceChart";

export default function App() {
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

  async function loadAll() {
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
    loadAll();
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
        setHistoryProductName(res.product?.name || "");
      })
      .catch((err) => setError(err.message));
  }, [selectedProductId]);

  const sortedUpdates = useMemo(() => summary.latest_updates || [], [summary]);
  const categoryOptions = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products]
  );

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
      await loadAll();
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
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onScrapeProduct(productId) {
    setError("");
    try {
      await api.scrapeProduct(productId);
      await loadAll();
      if (String(selectedProductId) === String(productId)) {
        const res = await api.getHistory(productId);
        setHistory(res.points || []);
        setHistoryProductName(res.product?.name || "");
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function onScrapeAll() {
    setError("");
    try {
      await api.scrapeAll();
      await loadAll();
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

  return (
    <div className="container py-4">
      <h2 className="mb-4">Competitor Price Tracker</h2>

      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <div className="alert alert-info">Loading...</div>}

      <div className="row g-3 mb-4">
        <div className="col-md-6">
          <div className="card p-3 shadow-sm metric-card metric-orange">
            <div className="text-muted">Total Competitors</div>
            <div className="display-6">{summary.total_competitors}</div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card p-3 shadow-sm metric-card metric-blue">
            <div className="text-muted">Total Tracked Products</div>
            <div className="display-6">{summary.total_products}</div>
          </div>
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12">
          <div className="card p-3 shadow-sm">
            <h5 className="mb-3">Live Product Pull: Vivo Shopify vs Competitors</h5>
            <form className="row g-2 mb-2" onSubmit={onLiveCompare}>
              <div className="col-md-4">
                <input
                  className="form-control"
                  placeholder="Product name from Vivo Shopify"
                  value={liveForm.product_name}
                  onChange={(e) => setLiveForm((s) => ({ ...s, product_name: e.target.value }))}
                  required
                />
              </div>
              <div className="col-md-4">
                <input
                  className="form-control"
                  placeholder="Base competitor"
                  value={liveForm.base_competitor}
                  onChange={(e) => setLiveForm((s) => ({ ...s, base_competitor: e.target.value }))}
                  required
                />
              </div>
              <div className="col-md-4 d-grid">
                <button className="btn btn-primary" disabled={liveLoading} type="submit">
                  {liveLoading ? "Searching..." : "Pull and Compare"}
                </button>
              </div>
            </form>

            {liveResult && (
              <>
                {!liveResult.base_found && (
                  <div className="alert alert-warning py-2">
                    Base competitor match not found for this query. Deltas are unavailable.
                  </div>
                )}
                <div className="table-responsive">
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
                          <td>{row.price}</td>
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

                {!!liveResult.failed?.length && (
                  <details className="mt-2">
                    <summary>Failed competitors ({liveResult.failed.length})</summary>
                    <ul className="mb-0 mt-2">
                      {liveResult.failed.map((f) => (
                        <li key={`${f.competitor}-${f.error}`}>{f.competitor}: {f.error}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-4">
          <div className="card p-3 shadow-sm h-100">
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
        </div>

        <div className="col-lg-8">
          <div className="card p-3 shadow-sm h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Products</h5>
              <button className="btn btn-outline-primary btn-sm" onClick={onScrapeAll}>Run Daily Scrape Now</button>
            </div>
            <form onSubmit={onAddProduct} className="row g-2 mb-3">
              <div className="col-md-2">
                <select
                  className="form-select"
                  value={productForm.competitor_id}
                  onChange={(e) => setProductForm((s) => ({ ...s, competitor_id: e.target.value }))}
                  required
                >
                  <option value="">Competitor</option>
                  {competitors.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <input
                  className="form-control"
                  placeholder="Store name"
                  value={productForm.product_name}
                  onChange={(e) => setProductForm((s) => ({ ...s, product_name: e.target.value }))}
                  required
                />
              </div>
              <div className="col-md-2">
                <input
                  className="form-control"
                  placeholder="Category"
                  value={productForm.category}
                  onChange={(e) => setProductForm((s) => ({ ...s, category: e.target.value }))}
                  required
                />
              </div>
              <div className="col-md-5">
                <input
                  className="form-control"
                  placeholder="Product URL"
                  value={productForm.product_url}
                  onChange={(e) => setProductForm((s) => ({ ...s, product_url: e.target.value }))}
                  required
                />
              </div>
              <div className="col-md-1 d-grid">
                <button className="btn btn-primary" type="submit">Add</button>
              </div>
            </form>

            <div className="table-responsive">
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
                      <td>{p.latest_price ?? "-"}</td>
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
                      <td colSpan="5" className="text-muted">No products tracked yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12">
          <div className="card p-3 shadow-sm">
            <h5 className="mb-3">Vivo Fashion Group vs Competitors</h5>
            <form className="row g-2 mb-3" onSubmit={onRunComparison}>
              <div className="col-md-3">
                <input
                  className="form-control"
                  value={comparisonForm.base_competitor}
                  onChange={(e) => setComparisonForm((s) => ({ ...s, base_competitor: e.target.value }))}
                  placeholder="Base competitor"
                  required
                />
              </div>
              <div className="col-md-5">
                <select
                  className="form-select"
                  value={comparisonForm.category}
                  onChange={(e) => setComparisonForm((s) => ({ ...s, category: e.target.value }))}
                  required
                >
                  <option value="">Select category (e.g. Maxi Dresses)</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-4 d-grid">
                <button className="btn btn-primary" type="submit">Compare</button>
              </div>
            </form>

            {comparison && (
              <>
                {!comparison.base_found && (
                  <div className="alert alert-warning py-2">
                    Base competitor not found in this selection. Showing prices without delta.
                  </div>
                )}
                <div className="table-responsive">
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
                          <td>{row.avg_price}</td>
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
              </>
            )}
          </div>
        </div>

        <div className="col-lg-8">
          <div className="card p-3 shadow-sm">
            <h5>Price History</h5>
            <PriceChart points={history} productName={historyProductName} />
          </div>
        </div>
        <div className="col-lg-4">
          <div className="card p-3 shadow-sm">
            <h5>Latest Updates</h5>
            <ul className="list-group list-group-flush">
              {sortedUpdates.map((u, idx) => (
                <li className="list-group-item px-0" key={`${u.product_id}-${idx}`}>
                  <div><strong>{u.product_name}</strong></div>
                  <div>{u.price} at {new Date(u.collected_at).toLocaleString()}</div>
                </li>
              ))}
              {!sortedUpdates.length && <li className="list-group-item px-0 text-muted">No updates yet.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
