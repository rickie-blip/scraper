import { useEffect, useState } from "react";
import { api } from "../api";
import { downloadCsv } from "../utils/csv";

const COLLECTION_PRESETS = [
  {
    key: "shopzetu-dresses",
    label: "Shopzetu Dresses",
    url: "https://pay.shopzetu.com/collections/dresses",
    currency: "KES",
  },
  {
    key: "neviive-dresses",
    label: "Neviive Dresses",
    url: "https://www.neviive.com/collections/dresses",
    currency: "KES",
  },
  {
    key: "nalani-dresses",
    label: "Nalani Dresses",
    url: "https://nalaniwomen.com/collections/dresses",
    currency: "KES",
  },
  {
    key: "ikojn-dresses",
    label: "Ikojn Dresses",
    url: "https://www.ikojn.com/collections/dresses",
    currency: "KES",
  },
];

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

export default function CollectionsPage() {
  const [competitors, setCompetitors] = useState([]);
  const [presetKey, setPresetKey] = useState("");
  const [collectionUrl, setCollectionUrl] = useState("");
  const [collectionCurrency, setCollectionCurrency] = useState("");
  const [selectedCompetitorId, setSelectedCompetitorId] = useState("");
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionResult, setCollectionResult] = useState(null);
  const [collectionError, setCollectionError] = useState("");

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
        setCollectionError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedCompetitorId) return;
    const competitor = competitors.find(
      (item) => String(item.id) === String(selectedCompetitorId)
    );
    if (competitor?.currency) {
      setCollectionCurrency(competitor.currency);
    }
  }, [competitors, selectedCompetitorId]);

  useEffect(() => {
    if (!presetKey) return;
    const preset = COLLECTION_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;
    setCollectionUrl(preset.url);
    if (preset.currency) {
      setCollectionCurrency(preset.currency);
    }
  }, [presetKey]);

  async function onCollectionSubmit(e) {
    e.preventDefault();
    setCollectionLoading(true);
    setCollectionError("");
    setCollectionResult(null);
    try {
      const res = await api.scrapeCollection({
        url: collectionUrl,
        currency: collectionCurrency,
      });
      setCollectionResult(res);
    } catch (err) {
      setCollectionError(err.message);
    } finally {
      setCollectionLoading(false);
    }
  }

  function exportResults() {
    if (!collectionResult?.data?.length) return;
    const rows = collectionResult.data.map((item) => ({
      title: item.title,
      price: item.price,
      compareAtPrice: item.compareAtPrice,
      image: item.images?.[0] || "",
      url: item.url,
    }));
    downloadCsv(`collection-scrape.csv`, rows);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Collection Scrapers</h2>
          <p>Scrape any Shopify collection URL and optional currency.</p>
        </div>
      </div>
      <form className="grid-row" onSubmit={onCollectionSubmit}>
        <select
          className="form-select"
          value={presetKey}
          onChange={(e) => setPresetKey(e.target.value)}
        >
          <option value="">Select preset (auto-fill)</option>
          {COLLECTION_PRESETS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          className="form-select"
          value={selectedCompetitorId}
          onChange={(e) => setSelectedCompetitorId(e.target.value)}
        >
          <option value="">Optional competitor</option>
          {competitors.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          className="form-control"
          value={collectionUrl}
          onChange={(e) => setCollectionUrl(e.target.value)}
          placeholder="Shopify collection URL"
          required
        />
        <input
          className="form-control"
          value={collectionCurrency}
          onChange={(e) => setCollectionCurrency(e.target.value.toUpperCase())}
          placeholder="Currency (optional)"
        />
        <button className="btn btn-primary" type="submit" disabled={collectionLoading}>
          {collectionLoading ? "Running..." : "Scrape Collection"}
        </button>
      </form>

      <div className="row-actions">
        <span className="muted">Endpoint: /api/collections/scrape</span>
        <button className="btn btn-outline-primary btn-sm" onClick={exportResults} disabled={!collectionResult?.data?.length}>
          Export CSV
        </button>
      </div>

      {collectionError && <div className="alert alert-warning mt-2">{collectionError}</div>}
      {collectionResult && (
        <div className="table-responsive mt-3">
          <table className="table table-sm align-middle">
            <thead>
              <tr>
                <th>Image</th>
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
                  <td>{formatPrice(item.price, item.currency)}</td>
                  <td>{formatPrice(item.compareAtPrice, item.currency)}</td>
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
    </div>
  );
}
