import { useEffect, useState } from "react";
import { api } from "../api";
import { downloadCsv } from "../utils/csv";

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "USD";
}

function formatPrice(value, currency = "USD") {
  if (value == null || value === "") return "-";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: normalizeCurrency(currency),
  }).format(numberValue);
}

export default function SearchPage() {
  const [competitors, setCompetitors] = useState([]);
  const [searchCompetitorId, setSearchCompetitorId] = useState("");
  const [presets, setPresets] = useState([]);
  const [presetKey, setPresetKey] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    let active = true;
    api
      .getCompetitors()
      .then((data) => {
        if (!active) return;
        setCompetitors(data);
        if (data.length) {
          setSearchCompetitorId(String(data[0].id));
        }
      })
      .catch((err) => {
        if (!active) return;
        setSearchError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!searchCompetitorId) return;
    let active = true;
    api
      .getSearchPresets(searchCompetitorId)
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data.presets) ? data.presets : [];
        setPresets(list);
        if (list.length) {
          setPresetKey(list[0]);
          setSearchQuery(list[0]);
        }
      })
      .catch((err) => {
        if (!active) return;
        setSearchError(err.message);
      });
    return () => {
      active = false;
    };
  }, [searchCompetitorId]);

  useEffect(() => {
    if (!presetKey) return;
    setSearchQuery(presetKey);
  }, [presetKey]);

  async function onSearchSubmit(e) {
    e.preventDefault();
    setSearchLoading(true);
    setSearchError("");
    setSearchResult(null);
    try {
      const res = await api.searchCompetitor(searchCompetitorId, searchQuery);
      setSearchResult(res);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearchLoading(false);
    }
  }

  function exportResults() {
    if (!searchResult?.data?.length) return;
    const rows = searchResult.data.map((item) => ({
      brand: item.brand,
      title: item.title,
      price: item.price,
      image: item.image,
      url: item.url,
    }));
    downloadCsv(`search-${searchCompetitorId || "competitor"}.csv`, rows);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Shopify Search Console</h2>
          <p>Search any competitor that you have added in the tracker.</p>
        </div>
      </div>
      <form className="grid-row" onSubmit={onSearchSubmit}>
        <select
          className="form-select"
          value={presetKey}
          onChange={(e) => setPresetKey(e.target.value)}
          disabled={!presets.length}
        >
          {!presets.length && <option value="">No presets</option>}
          {presets.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          className="form-select"
          value={searchCompetitorId}
          onChange={(e) => setSearchCompetitorId(e.target.value)}
          required
        >
          <option value="">Select competitor...</option>
          {competitors.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          className="form-control"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search keyword or category"
          required
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={searchLoading || !searchCompetitorId}
        >
          {searchLoading ? "Searching..." : "Run Search"}
        </button>
      </form>

      <div className="row-actions">
        <span className="muted">Endpoint: /api/competitors/:id/search</span>
        <button className="btn btn-outline-primary btn-sm" onClick={exportResults} disabled={!searchResult?.data?.length}>
          Export CSV
        </button>
      </div>

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
                  <td>{formatPrice(item.price, item.currency)}</td>
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
    </div>
  );
}
