import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { downloadCsv } from "../utils/csv";

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "KSH") return "KES";
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "KES";
}

function formatPrice(value, currency = "KES") {
  if (value == null || value === "") return "-";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: normalizeCurrency(currency),
  }).format(numberValue);
}

function formatPriceWithOriginal(item, displayCurrency) {
  if (!displayCurrency) {
    return item?.price == null || item?.price === "" ? "-" : String(item.price);
  }
  const main = formatPrice(item?.price, displayCurrency);
  const originalCurrency = normalizeCurrency(item?.original_currency || "");
  const originalPrice = item?.original_price;
  if (
    originalPrice != null &&
    originalPrice !== "" &&
    originalCurrency &&
    originalCurrency !== normalizeCurrency(displayCurrency)
  ) {
    const original = formatPrice(originalPrice, originalCurrency);
    return `${main} (${original})`;
  }
  return main;
}

function resolveImage(item) {
  if (!item) return null;
  if (item.image) return item.image;
  if (Array.isArray(item.images)) {
    const first = item.images[0];
    if (typeof first === "string") return first;
    if (first?.src) return first.src;
  }
  return null;
}

const PAGE_SIZE = 50;

export default function SearchMorePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const query = params.get("q") || "";

  const [results, setResults] = useState([]);
  const [brand, setBrand] = useState("");
  const [competitorCurrency, setCompetitorCurrency] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(results.length / PAGE_SIZE)),
    [results.length]
  );
  const pagedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return results.slice(start, start + PAGE_SIZE);
  }, [page, results]);

  useEffect(() => {
    let active = true;
    if (!id || !query) return undefined;
    setLoading(true);
    setError("");
    api
      .searchCompetitor(id, query, { persist: false })
      .then((res) => {
        if (!active) return;
        setResults(res.data || []);
        setBrand(res.data?.[0]?.brand || "");
        setPage(1);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || "Search failed.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, query]);

  useEffect(() => {
    let active = true;
    if (!id) return undefined;
    api
      .getCompetitors()
      .then((data) => {
        if (!active) return;
        const match = data.find((item) => String(item.id) === String(id));
        if (match?.name) setBrand(match.name);
        if (match?.currency) setCompetitorCurrency(match.currency);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      active = false;
    };
  }, [id]);

  function exportResults() {
    if (!results.length) return;
    const rows = results.map((item) => ({
      brand: item.brand,
      title: item.title,
      price: item.price,
      image: resolveImage(item),
      url: item.url,
    }));
    downloadCsv(`search-${id || "competitor"}-full.csv`, rows);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Full Search Results</h2>
          <p>
            {brand || "Competitor"} results for <strong>{query || "search"}</strong>
          </p>
        </div>
        <div className="row-actions">
          <Link className="btn btn-outline-secondary" to="/search">
            Back to Search
          </Link>
          <button className="btn btn-outline-primary" onClick={exportResults} disabled={!results.length}>
            Export CSV
          </button>
        </div>
      </div>

      {loading && <div className="muted">Loading results...</div>}
      {error && <div className="alert alert-warning mt-2">{error}</div>}

      {!loading && !error && (
        <>
          <div className="table-actions">
            <div className="muted">
              Showing {pagedItems.length} of {results.length} items
            </div>
            {results.length > PAGE_SIZE && (
              <div className="pager">
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                >
                  Prev
                </button>
                <span className="muted">
                  Page {page} of {totalPages}
                </span>
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </button>
              </div>
            )}
          </div>
          <div className="table-responsive">
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
                {pagedItems.map((item, idx) => {
                  const imageUrl = resolveImage(item);
                  return (
                    <tr key={`${item.url}-${idx}`}>
                      <td>
                        {imageUrl ? (
                          <img className="thumb" src={imageUrl} alt={item.title} />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{item.title}</td>
                      <td>{item.brand}</td>
                      <td>
                        {formatPriceWithOriginal(
                          item,
                          item.currency || competitorCurrency
                        )}
                      </td>
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
                  );
                })}
                {!pagedItems.length && (
                  <tr>
                    <td className="text-muted" colSpan="5">
                      No results returned.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
