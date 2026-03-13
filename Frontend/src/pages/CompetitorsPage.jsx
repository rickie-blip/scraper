import { useEffect, useState } from "react";
import { api } from "../api";
import PriceChart from "../PriceChart";

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "KSH") return "KES";
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "KES";
}

function formatPrice(value, currency = "KES") {
  if (value == null || value === "") return "-";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  const safeCurrency = normalizeCurrency(currency);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: safeCurrency,
  }).format(numberValue);
}

export default function Competitors() {
  const [summary, setSummary] = useState({ total_competitors: 0, total_products: 0, latest_updates: [] });
  const [competitors, setCompetitors] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  
  // Competitor management
  const [competitorForm, setCompetitorForm] = useState({ name: "", website: "", currency: "KES" });
  const [editingCompetitorId, setEditingCompetitorId] = useState(null);
  const [editCompetitorForm, setEditCompetitorForm] = useState({ name: "", website: "", currency: "" });
  
  // Product management
  const [productForm, setProductForm] = useState({ 
    competitor_id: "", 
    product_name: "", 
    category: "", 
    product_url: "", 
    currency: "" 
  });
  const [scrapeProductMessage, setScrapeProductMessage] = useState("");
  const [scrapeAllLoading, setScrapeAllLoading] = useState(false);
  
  // Price history
  const [selectedProductHistory, setSelectedProductHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  // Comparison
  const [comparisonData, setComparisonData] = useState(null);
  const [comparisonFilters, setComparisonFilters] = useState({ base_competitor: "", category: "" });
  
  // Live compare
  const [liveCompareForm, setLiveCompareForm] = useState({ product_name: "", base_competitor: "" });
  const [liveCompareResult, setLiveCompareResult] = useState(null);
  const [liveCompareLoading, setLiveCompareLoading] = useState(false);

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

  async function loadTracker() {
    setLoading(true);
    setError("");
    try {
      const [s, c, p] = await Promise.all([
        api.getSummary(), 
        api.getCompetitors(), 
        api.getProducts()
      ]);
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
    loadTracker();
  }, []);

  // Competitor CRUD
  async function onAddCompetitor(e) {
    e.preventDefault();
    setError("");
    try {
      const website = normalizeWebsiteUrl(competitorForm.website);
      if (!isValidWebsiteUrl(website)) {
        setError("Please enter a valid website URL.");
        return;
      }
      const currency = competitorForm.currency.trim().toUpperCase() || "KES";
      await api.addCompetitor({ ...competitorForm, currency, website });
      setCompetitorForm({ name: "", website: "", currency: "KES" });
      await loadTracker();
    } catch (err) {
      setError(err.message);
    }
  }

  function onEditCompetitorStart(competitor) {
    setEditingCompetitorId(competitor.id);
    setEditCompetitorForm({
      name: competitor.name || "",
      website: competitor.website || "",
      currency: competitor.currency || "",
    });
  }

  function onEditCompetitorCancel() {
    setEditingCompetitorId(null);
    setEditCompetitorForm({ name: "", website: "", currency: "" });
  }

  async function onEditCompetitorSave(e, competitorId) {
    e.preventDefault();
    setError("");
    try {
      const website = normalizeWebsiteUrl(editCompetitorForm.website);
      if (!isValidWebsiteUrl(website)) {
        setError("Please enter a valid website URL.");
        return;
      }
      const currency = editCompetitorForm.currency.trim().toUpperCase();
      await api.updateCompetitor(competitorId, {
        ...editCompetitorForm,
        currency,
        website,
      });
      onEditCompetitorCancel();
      await loadTracker();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onDeleteCompetitor(competitorId) {
    const confirmed = window.confirm(
      "Delete this competitor? This also removes its products and history."
    );
    if (!confirmed) return;
    setError("");
    try {
      await api.deleteCompetitor(competitorId);
      if (editingCompetitorId === competitorId) {
        onEditCompetitorCancel();
      }
      await loadTracker();
    } catch (err) {
      setError(err.message);
    }
  }

  // Product management
  async function onAddProduct(e) {
    e.preventDefault();
    setError("");
    try {
      const website = normalizeWebsiteUrl(productForm.product_url);
      if (!isValidWebsiteUrl(website)) {
        setError("Please enter a valid product URL.");
        return;
      }
      const currency = productForm.currency.trim().toUpperCase();
      await api.addProduct({ ...productForm, currency, product_url: website });
      setProductForm({ 
        competitor_id: "", 
        product_name: "", 
        category: "", 
        product_url: "", 
        currency: "" 
      });
      await loadTracker();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onScrapeProduct(productId) {
    setError("");
    setScrapeProductMessage("");
    try {
      const res = await api.scrapeProduct(productId);
      await loadTracker();
      if (res?.entry?.price != null) {
        const product = products.find((item) => String(item.id) === String(productId));
        const productCurrency = product?.currency || product?.competitor_currency || "KES";
        setScrapeProductMessage(
          `Scrape succeeded. Latest price: ${formatPrice(res.entry.price, productCurrency)}.`
        );
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function onScrapeAll() {
    setError("");
    setScrapeAllLoading(true);
    try {
      const res = await api.scrapeAll();
      await loadTracker();
      const successCount = res.results?.filter(r => r.ok).length || 0;
      const failCount = res.results?.filter(r => !r.ok).length || 0;
      setScrapeProductMessage(`Scrape completed: ${successCount} succeeded, ${failCount} failed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setScrapeAllLoading(false);
    }
  }

  // Price history
  async function viewProductHistory(productId) {
    setHistoryLoading(true);
    setError("");
    try {
      const data = await api.getHistory(productId);
      setSelectedProductHistory(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  // Comparison
  async function loadComparison() {
    setError("");
    try {
      const data = await api.getComparison(comparisonFilters);
      setComparisonData(data);
    } catch (err) {
      setError(err.message);
    }
  }

  // Live compare
  async function onLiveCompare(e) {
    e.preventDefault();
    setError("");
    setLiveCompareLoading(true);
    setLiveCompareResult(null);
    try {
      const res = await api.liveCompare(liveCompareForm);
      setLiveCompareResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLiveCompareLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Competitor Price Tracker</h2>
          <p>Manage competitors, track products, and compare prices dynamically.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <div className="alert alert-info">Loading tracker data...</div>}

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

      {/* Competitor Management */}
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
            <label className="form-label mb-1">Currency (ISO code)</label>
            <input
              className="form-control mb-2"
              placeholder="e.g. KES"
              value={competitorForm.currency}
              onChange={(e) => setCompetitorForm((s) => ({ ...s, currency: e.target.value }))}
              maxLength={3}
            />
            <button className="btn btn-primary" type="submit">Add Competitor</button>
          </form>
        </div>

        <div className="card-block">
          <h5>Competitors</h5>
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Website</th>
                  <th>Currency</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c) => {
                  const isEditing = editingCompetitorId === c.id;
                  return (
                    <tr key={c.id}>
                      <td>
                        {isEditing ? (
                          <input
                            className="form-control form-control-sm"
                            value={editCompetitorForm.name}
                            onChange={(e) =>
                              setEditCompetitorForm((s) => ({ ...s, name: e.target.value }))
                            }
                            required
                          />
                        ) : (
                          c.name
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="form-control form-control-sm"
                            value={editCompetitorForm.website}
                            onChange={(e) =>
                              setEditCompetitorForm((s) => ({ ...s, website: e.target.value }))
                            }
                            required
                          />
                        ) : (
                          <a href={c.website} target="_blank" rel="noreferrer">{c.website || "-"}</a>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="form-control form-control-sm"
                            value={editCompetitorForm.currency}
                            onChange={(e) =>
                              setEditCompetitorForm((s) => ({ ...s, currency: e.target.value }))
                            }
                            maxLength={3}
                          />
                        ) : (
                          c.currency || "-"
                        )}
                      </td>
                      <td className="text-end">
                        {isEditing ? (
                          <>
                            <button
                              className="btn btn-primary btn-sm me-2"
                              onClick={(e) => onEditCompetitorSave(e, c.id)}
                            >
                              Save
                            </button>
                            <button
                              className="btn btn-outline-secondary btn-sm"
                              onClick={onEditCompetitorCancel}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn btn-outline-secondary btn-sm me-2"
                              onClick={() => onEditCompetitorStart(c)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-outline-danger btn-sm"
                              onClick={() => onDeleteCompetitor(c.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!competitors.length && (
                  <tr>
                    <td colSpan="4" className="text-muted">No competitors yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Product Management */}
      <div className="card-block mt-3">
        <h5>Add Product to Track</h5>
        <form onSubmit={onAddProduct}>
          <div className="row">
            <div className="col-md-3">
              <label className="form-label mb-1">Competitor</label>
              <select
                className="form-control mb-2"
                value={productForm.competitor_id}
                onChange={(e) => setProductForm((s) => ({ ...s, competitor_id: e.target.value }))}
                required
              >
                <option value="">Select competitor...</option>
                {competitors.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label mb-1">Product Name</label>
              <input
                className="form-control mb-2"
                placeholder="e.g. Red Bodycon Dress"
                value={productForm.product_name}
                onChange={(e) => setProductForm((s) => ({ ...s, product_name: e.target.value }))}
                required
              />
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1">Category</label>
              <input
                className="form-control mb-2"
                placeholder="e.g. Dresses"
                value={productForm.category}
                onChange={(e) => setProductForm((s) => ({ ...s, category: e.target.value }))}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label mb-1">Product URL</label>
              <input
                className="form-control mb-2"
                placeholder="https://..."
                value={productForm.product_url}
                onChange={(e) => setProductForm((s) => ({ ...s, product_url: e.target.value }))}
                required
              />
            </div>
            <div className="col-md-1">
              <label className="form-label mb-1">Currency</label>
              <input
                className="form-control mb-2"
                placeholder="KES"
                value={productForm.currency}
                onChange={(e) => setProductForm((s) => ({ ...s, currency: e.target.value }))}
                maxLength={3}
              />
            </div>
          </div>
          <button className="btn btn-primary" type="submit">Add Product</button>
        </form>
      </div>

      {/* Tracked Products */}
      <div className="table-responsive mt-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5>Tracked Products</h5>
          <button 
            className="btn btn-success btn-sm" 
            onClick={onScrapeAll}
            disabled={scrapeAllLoading || !products.length}
          >
            {scrapeAllLoading ? "Scraping All..." : "Scrape All Products"}
          </button>
        </div>
        {scrapeProductMessage && <div className="alert alert-success">{scrapeProductMessage}</div>}
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Competitor</th>
              <th>Latest Price</th>
              <th>Last Collected</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <a href={p.product_url} target="_blank" rel="noreferrer">{p.product_name}</a>
                </td>
                <td>{p.category}</td>
                <td>{p.competitor_name}</td>
                <td>{formatPrice(p.latest_price, p.currency || p.competitor_currency || "KES")}</td>
                <td>{p.latest_collected_at ? new Date(p.latest_collected_at).toLocaleString() : "-"}</td>
                <td className="text-end">
                  <button className="btn btn-outline-info btn-sm me-1" onClick={() => viewProductHistory(p.id)}>
                    History
                  </button>
                  <button className="btn btn-outline-primary btn-sm" onClick={() => onScrapeProduct(p.id)}>
                    Scrape
                  </button>
                </td>
              </tr>
            ))}
            {!products.length && (
              <tr>
                <td colSpan="6" className="text-muted">
                  No products tracked yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Price History */}
      {selectedProductHistory && (
        <div className="card-block mt-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h5>Price History: {selectedProductHistory.product.product_name}</h5>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelectedProductHistory(null)}>Close</button>
          </div>
          {historyLoading ? (
            <div className="alert alert-info">Loading history...</div>
          ) : selectedProductHistory.points?.length > 0 ? (
            <>
              <PriceChart 
                points={selectedProductHistory.points} 
                productName={selectedProductHistory.product.product_name}
                currency={selectedProductHistory.product.currency || selectedProductHistory.product.competitor_currency} 
              />
              <table className="table table-sm mt-3">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProductHistory.points.map((point) => (
                    <tr key={point.id}>
                      <td>{new Date(point.collected_at).toLocaleString()}</td>
                      <td>{formatPrice(point.price, selectedProductHistory.product.currency || selectedProductHistory.product.competitor_currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="alert alert-info">No price history available yet.</div>
          )}
        </div>
      )}

      {/* Price Comparison */}
      <div className="card-block mt-3">
        <h5>Price Comparison</h5>
        <div className="row mb-3">
          <div className="col-md-4">
            <label className="form-label mb-1">Base Competitor</label>
            <select
              className="form-control"
              value={comparisonFilters.base_competitor}
              onChange={(e) => setComparisonFilters((s) => ({ ...s, base_competitor: e.target.value }))}
            >
              <option value="">Select base...</option>
              {competitors.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label mb-1">Category Filter</label>
            <input
              className="form-control"
              placeholder="e.g. Dresses"
              value={comparisonFilters.category}
              onChange={(e) => setComparisonFilters((s) => ({ ...s, category: e.target.value }))}
            />
          </div>
          <div className="col-md-4 d-flex align-items-end">
            <button className="btn btn-primary" onClick={loadComparison}>Compare Prices</button>
          </div>
        </div>
        {comparisonData && (
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Competitor</th>
                <th>Items</th>
                <th>Avg Price</th>
                <th>Delta vs Base</th>
                <th>Delta %</th>
              </tr>
            </thead>
            <tbody>
              {comparisonData.rows?.map((row) => (
                <tr key={row.competitor}>
                  <td>{row.competitor}</td>
                  <td>{row.items_count}</td>
                  <td>{formatPrice(row.avg_price, "KES")}</td>
                  <td className={row.delta_vs_vivo > 0 ? "text-danger" : row.delta_vs_vivo < 0 ? "text-success" : ""}>
                    {row.delta_vs_vivo != null ? formatPrice(row.delta_vs_vivo, "KES") : "-"}
                  </td>
                  <td className={row.delta_pct_vs_vivo > 0 ? "text-danger" : row.delta_pct_vs_vivo < 0 ? "text-success" : ""}>
                    {row.delta_pct_vs_vivo != null ? `${row.delta_pct_vs_vivo}%` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Live Product Compare */}
      <div className="card-block mt-3">
        <h5>Live Product Compare</h5>
        <p className="text-muted">Search for a product across all competitors in real-time.</p>
        <form onSubmit={onLiveCompare}>
          <div className="row">
            <div className="col-md-5">
              <label className="form-label mb-1">Product Name</label>
              <input
                className="form-control mb-2"
                placeholder="e.g. Red Dress"
                value={liveCompareForm.product_name}
                onChange={(e) => setLiveCompareForm((s) => ({ ...s, product_name: e.target.value }))}
                required
              />
            </div>
            <div className="col-md-5">
              <label className="form-label mb-1">Base Competitor</label>
              <select
                className="form-control mb-2"
                value={liveCompareForm.base_competitor}
                onChange={(e) => setLiveCompareForm((s) => ({ ...s, base_competitor: e.target.value }))}
                required
              >
                <option value="">Select base...</option>
                {competitors.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button className="btn btn-primary mb-2" type="submit" disabled={liveCompareLoading}>
                {liveCompareLoading ? "Searching..." : "Compare"}
              </button>
            </div>
          </div>
        </form>
        {liveCompareResult && (
          <div className="mt-3">
            {liveCompareResult.matches?.length > 0 ? (
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Competitor</th>
                    <th>Product</th>
                    <th>Price</th>
                    <th>Delta vs Base</th>
                    <th>Delta %</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {liveCompareResult.matches.map((match, idx) => (
                    <tr key={idx}>
                      <td>{match.competitor}</td>
                      <td>{match.product_name}</td>
                      <td>{formatPrice(match.price, "KES")}</td>
                      <td className={match.delta_vs_vivo > 0 ? "text-danger" : match.delta_vs_vivo < 0 ? "text-success" : ""}>
                        {match.delta_vs_vivo != null ? formatPrice(match.delta_vs_vivo, "KES") : "-"}
                      </td>
                      <td className={match.delta_pct_vs_vivo > 0 ? "text-danger" : match.delta_pct_vs_vivo < 0 ? "text-success" : ""}>
                        {match.delta_pct_vs_vivo != null ? `${match.delta_pct_vs_vivo}%` : "-"}
                      </td>
                      <td>
                        <a href={match.product_url} target="_blank" rel="noreferrer">View</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="alert alert-info">No matches found.</div>
            )}
            {liveCompareResult.failed?.length > 0 && (
              <div className="alert alert-warning mt-2">
                <strong>Failed searches:</strong> {liveCompareResult.failed.map(f => f.competitor).join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Latest Updates */}
      {summary.latest_updates?.length > 0 && (
        <div className="card-block mt-3">
          <h5>Latest Price Updates</h5>
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Product</th>
                <th>Price</th>
                <th>Collected At</th>
              </tr>
            </thead>
            <tbody>
              {summary.latest_updates.map((update) => (
                <tr key={update.product_id}>
                  <td>{update.product_name}</td>
                  <td>{formatPrice(update.price, "KES")}</td>
                  <td>{new Date(update.collected_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
