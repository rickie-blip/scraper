import { useEffect, useState } from "react";
import { api } from "../api";

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "USD";
}

function formatPrice(value, currency = "USD") {
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [competitorForm, setCompetitorForm] = useState({ name: "", website: "", currency: "" });
  const [editingCompetitorId, setEditingCompetitorId] = useState(null);
  const [editCompetitorForm, setEditCompetitorForm] = useState({
    name: "",
    website: "",
    currency: "",
  });
  const [comparisonData, setComparisonData] = useState(null);
  const [comparisonFilters, setComparisonFilters] = useState({ base_competitor: "", category: "" });
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
      const [s, c] = await Promise.all([api.getSummary(), api.getCompetitors()]);
      setSummary(s);
      setCompetitors(c);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTracker();
  }, []);

  async function onAddCompetitor(e) {
    e.preventDefault();
    setError("");
    try {
      const website = normalizeWebsiteUrl(competitorForm.website);
      if (!isValidWebsiteUrl(website)) {
        setError("Please enter a valid website URL.");
        return;
      }
      const currency = competitorForm.currency.trim().toUpperCase();
      await api.addCompetitor({ ...competitorForm, currency, website });
      setCompetitorForm({ name: "", website: "", currency: "" });
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

  async function loadComparison() {
    setError("");
    try {
      const data = await api.getComparison(comparisonFilters);
      setComparisonData(data);
    } catch (err) {
      setError(err.message);
    }
  }

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
          <p>Persistent tracking using the backend storage API.</p>
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
              placeholder="e.g. USD"
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
                          c.website || "-"
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
              <option value="">All competitors</option>
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
                <option value="">All competitors</option>
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
