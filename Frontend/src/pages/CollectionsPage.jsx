import { useEffect, useState } from "react";
import { api } from "../api";
import { downloadCsv } from "../utils/csv";

const COLLECTION_TARGETS = [
  {
    key: "vivo-dresses-collection",
    label: "Vivo Dresses Collection (Shopzetu)",
    route: "/scrape-vivo-dresses-collection",
    defaultUrl: "https://pay.shopzetu.com/collections/dresses",
    run: api.scrapeVivoDressesCollection,
  },
  {
    key: "neviive-dresses-collection",
    label: "Neviive Dresses Collection",
    route: "/scrape-neviive-dresses-collection",
    defaultUrl: "https://www.neviive.com/collections/dresses",
    run: api.scrapeNeviiveDressesCollection,
  },
  {
    key: "ikojn-dresses",
    label: "Ikojn Dresses Collection",
    route: "/ikojn-dresses",
    defaultUrl: "https://www.ikojn.com/collections/dresses",
    run: api.ikojnDresses,
  },
  {
    key: "nalani-dresses-collection",
    label: "Nalani Dresses Collection",
    route: "/nalani-dresses-collection",
    defaultUrl: "https://nalaniwomen.com/collections/dresses",
    run: api.nalaniDressesCollection,
  },
];

function formatPrice(value) {
  if (value == null || value === "") return "-";
  return typeof value === "number" ? `$${value}` : String(value);
}

export default function CollectionsPage() {
  const [collectionTarget, setCollectionTarget] = useState(COLLECTION_TARGETS[0].key);
  const [collectionUrl, setCollectionUrl] = useState(COLLECTION_TARGETS[0].defaultUrl);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionResult, setCollectionResult] = useState(null);
  const [collectionError, setCollectionError] = useState("");

  const target = COLLECTION_TARGETS.find((t) => t.key === collectionTarget) || COLLECTION_TARGETS[0];

  useEffect(() => {
    setCollectionUrl(target.defaultUrl);
    setCollectionResult(null);
    setCollectionError("");
  }, [target.key]);

  async function onCollectionSubmit(e) {
    e.preventDefault();
    setCollectionLoading(true);
    setCollectionError("");
    setCollectionResult(null);
    try {
      const res = await target.run(collectionUrl);
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
    downloadCsv(`collection-${target.key}.csv`, rows);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Collection Scrapers</h2>
          <p>Pull full product lists from each collection endpoint.</p>
        </div>
      </div>
      <form className="grid-row" onSubmit={onCollectionSubmit}>
        <select className="form-select" value={collectionTarget} onChange={(e) => setCollectionTarget(e.target.value)}>
          {COLLECTION_TARGETS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label} ({item.route})
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

      <div className="row-actions">
        <span className="muted">Endpoint: {target.route}</span>
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
    </div>
  );
}
