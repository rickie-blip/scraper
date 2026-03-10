import { useEffect, useState } from "react";
import { api } from "../api";
import { downloadCsv } from "../utils/csv";

const SEARCH_TARGETS = [
  {
    key: "vivo-bodycons",
    label: "Shopzetu Vivo Bodycons",
    route: "/search-vivo-bodycons",
    defaultQuery: "bodycons",
    run: api.searchVivoBodycons,
  },
  {
    key: "nalani-bodycons",
    label: "Nalani Bodycons",
    route: "/search-nalani-bodycons",
    defaultQuery: "bodycons",
    run: api.searchNalaniBodycons,
  },
  {
    key: "neviive-bodycons",
    label: "Neviive Bodycons",
    route: "/search-neviive-bodycons",
    defaultQuery: "bodycons",
    run: api.searchNeviiveBodycons,
  },
  {
    key: "dirac-bodycons",
    label: "Dirac Fashion Bodycons",
    route: "/search-dirac-bodycons",
    defaultQuery: "bodycons",
    run: api.searchDiracBodycons,
  },
  {
    key: "vivo-bodysuits",
    label: "Shopzetu Vivo Bodysuits",
    route: "/search-vivo-bodysuits",
    defaultQuery: "bodysuits",
    run: api.searchVivoBodysuits,
  },
  {
    key: "nalani-bodysuits",
    label: "Nalani Bodysuits",
    route: "/search-nalani-bodysuits",
    defaultQuery: "bodysuits",
    run: api.searchNalaniBodysuits,
  },
  {
    key: "neviive-bodysuits",
    label: "Neviive Bodysuits",
    route: "/search-neviive-bodysuits",
    defaultQuery: "bodysuits",
    run: api.searchNeviiveBodysuits,
  },
  {
    key: "dirac-bodysuits",
    label: "Dirac Fashion Bodysuits",
    route: "/search-dirac-bodysuits",
    defaultQuery: "bodysuits",
    run: api.searchDiracBodysuits,
  },
  {
    key: "vivo-dresses",
    label: "Shopzetu Vivo Dresses",
    route: "/search-vivo-dresses",
    defaultQuery: "dresses",
    run: api.searchVivoDresses,
  },
  {
    key: "nalani-dresses",
    label: "Nalani Dresses",
    route: "/search-nalani-dresses",
    defaultQuery: "dresses",
    run: api.searchNalaniDresses,
  },
  {
    key: "neviive-dresses",
    label: "Neviive Dresses",
    route: "/search-neviive-dresses",
    defaultQuery: "dresses",
    run: api.searchNeviiveDresses,
  },
  {
    key: "dirac-dresses",
    label: "Dirac Fashion Dresses",
    route: "/search-dirac-dresses",
    defaultQuery: "dresses",
    run: api.searchDiracDresses,
  },
];

function formatPrice(value) {
  if (value == null || value === "") return "-";
  return typeof value === "number" ? `$${value}` : String(value);
}

export default function SearchPage() {
  const [searchTarget, setSearchTarget] = useState(SEARCH_TARGETS[0].key);
  const [searchQuery, setSearchQuery] = useState(SEARCH_TARGETS[0].defaultQuery);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState("");

  const target = SEARCH_TARGETS.find((t) => t.key === searchTarget) || SEARCH_TARGETS[0];

  useEffect(() => {
    setSearchQuery(target.defaultQuery);
    setSearchResult(null);
    setSearchError("");
  }, [target.key]);

  async function onSearchSubmit(e) {
    e.preventDefault();
    setSearchLoading(true);
    setSearchError("");
    setSearchResult(null);
    try {
      const res = await target.run(searchQuery);
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
    downloadCsv(`search-${target.key}.csv`, rows);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Shopify Search Console</h2>
          <p>Directly calls the backend search routes for quick product snapshots.</p>
        </div>
      </div>
      <form className="grid-row" onSubmit={onSearchSubmit}>
        <select className="form-select" value={searchTarget} onChange={(e) => setSearchTarget(e.target.value)}>
          {SEARCH_TARGETS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label} ({item.route})
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
          {searchLoading ? "Searching..." : "Run Search"}
        </button>
      </form>

      <div className="row-actions">
        <span className="muted">Endpoint: {target.route}</span>
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
    </div>
  );
}
