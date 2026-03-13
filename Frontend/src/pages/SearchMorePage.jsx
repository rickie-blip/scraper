import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { downloadXlsx } from "../utils/xlsx";

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

function extractImageUrl(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw) return null;
  if (!raw.includes("<")) {
    const normalized = raw.startsWith("//") ? `https:${raw}` : raw;
    return normalized.replace("{width}", "800").replace("%7Bwidth%7D", "800");
  }
  try {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const img = doc.querySelector("img");
    if (img?.getAttribute("src")) {
      const src = img.getAttribute("src").trim();
      const normalized = src.startsWith("//") ? `https:${src}` : src;
      return normalized.replace("{width}", "800").replace("%7Bwidth%7D", "800");
    }
  } catch {
    // ignore
  }
  const match = raw.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  if (match?.[1]) {
    const src = match[1].trim();
    const normalized = src.startsWith("//") ? `https:${src}` : src;
    return normalized.replace("{width}", "800").replace("%7Bwidth%7D", "800");
  }
  return null;
}

function resolveImage(item) {
  if (!item) return null;
  if (item.image) return extractImageUrl(item.image);
  if (Array.isArray(item.images)) {
    const first = item.images[0];
    if (typeof first === "string") return extractImageUrl(first);
    if (first?.src) return extractImageUrl(first.src);
  }
  return null;
}

function sanitizeText(value) {
  if (value == null) return "";
  const raw = String(value);
  if (!raw.includes("<")) return raw.trim();
  let text = "";
  try {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    text = doc.body?.textContent?.trim() || "";
  } catch {
    text = "";
  }
  if (!text) {
    const altMatch = raw.match(/\balt\s*=\s*["']([^"']+)["']/i);
    if (altMatch) text = altMatch[1];
  }
  if (text) return text;
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function resolveTitle(item) {
  const candidates = [item?.title, item?.product_name, item?.name];
  for (const candidate of candidates) {
    const text = sanitizeText(candidate || "");
    if (!text) continue;
    if (text.toLowerCase() === "new in") continue;
    if (text.toLowerCase() === "product image") continue;
    return text;
  }
  const url = String(item?.url || "").trim();
  if (url) {
    const slug = url.split("/").filter(Boolean).pop() || "";
    if (slug) {
      return slug
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
    }
  }
  return "";
}

function normalizeBrand(value) {
  return String(value || "").trim().toLowerCase();
}

function filterItemsForCompetitor(items, competitorName) {
  if (!Array.isArray(items) || !items.length) return [];
  const target = normalizeBrand(competitorName);
  if (!target) return items;
  return items.filter((item) => normalizeBrand(item?.brand) === target);
}

export default function SearchMorePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const query = params.get("q") || "";

  const [results, setResults] = useState({});
  const [brand, setBrand] = useState("");
  const [competitorCurrency, setCompetitorCurrency] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const totalPages = useMemo(() => {
    const total = results?.total ?? results?.data?.length ?? 0;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [results, pageSize]);
  const filteredItems = useMemo(() => {
    if (!results?.data?.length) return [];
    return filterItemsForCompetitor(results.data, brand);
  }, [results, brand]);
  const pagedItems = useMemo(() => filteredItems, [filteredItems]);
  const displayItems = useMemo(() => pagedItems.slice(0, 10), [pagedItems]);

  useEffect(() => {
    let active = true;
    if (!id || !query) return undefined;
    setLoading(true);
    setError("");
    api
      .searchCompetitor(id, query, { persist: false, page: 1, page_size: pageSize })
      .then((res) => {
        if (!active) return;
        setResults(res || {});
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

  async function exportResults() {
    if (!results?.data?.length) return;
    const collected = [];
    let currentPage = 1;
    let hasMore = true;
    while (hasMore) {
      const payload = await api.searchCompetitor(id, query, {
        persist: false,
        refresh: false,
        page: currentPage,
        page_size: pageSize,
      });
      collected.push(...(payload?.data || []));
      hasMore = payload?.has_more;
      currentPage += 1;
      if (!payload?.data?.length) break;
    }
    const rows = collected.map((item) => ({
      Brand: item.brand || brand || "",
      Category: query || "",
      "Product Image": resolveImage(item) || "",
      "Product Link": item.url || "",
      "Product Name": resolveTitle(item),
      Price: item.price ?? "",
    }));
    downloadXlsx(`search-${id || "competitor"}-full.xlsx`, rows, {
      sheetBy: "Category",
      headers: ["Brand", "Category", "Product Image", "Product Link", "Product Name", "Price"],
    });
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
          <button
            className="btn btn-outline-primary"
            onClick={() => {
              setLoading(true);
              setError("");
              api
                .searchCompetitor(id, query, { persist: true, refresh: true, page: 1, page_size: pageSize })
                .then((res) => {
                  setResults(res || {});
                  setBrand(res.data?.[0]?.brand || brand || "");
                  setPage(1);
                })
                .catch((err) => setError(err.message || "Search failed."))
                .finally(() => setLoading(false));
            }}
            disabled={!id || !query}
          >
            Refresh
          </button>
          <button className="btn btn-outline-primary" onClick={exportResults} disabled={!results?.data?.length}>
            Export Excel
          </button>
        </div>
      </div>

      {loading && <div className="muted">Loading results...</div>}
      {error && <div className="alert alert-warning mt-2">{error}</div>}

      {!loading && !error && (
        <>
          <div className="table-actions">
            <div className="muted">
              Showing {displayItems.length} of {results?.total ?? pagedItems.length} items
            </div>
            {(results?.total ?? 0) > pageSize && (
              <div className="pager">
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() =>
                    api
                      .searchCompetitor(id, query, {
                        persist: false,
                        refresh: false,
                        page: Math.max(1, page - 1),
                        page_size: pageSize,
                      })
                      .then((res) => {
                        setResults(res || {});
                        setPage((prev) => Math.max(1, prev - 1));
                      })
                  }
                  disabled={page <= 1}
                >
                  Prev
                </button>
                <span className="muted">
                  Page {page} of {totalPages}
                </span>
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() =>
                    api
                      .searchCompetitor(id, query, {
                        persist: false,
                        refresh: false,
                        page: Math.min(totalPages, page + 1),
                        page_size: pageSize,
                      })
                      .then((res) => {
                        setResults(res || {});
                        setPage((prev) => Math.min(totalPages, prev + 1));
                      })
                  }
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
                {displayItems.map((item, idx) => {
                  const imageUrl = resolveImage(item);
                  const displayTitle = resolveTitle(item);
                  return (
                    <tr key={`${item.url}-${idx}`}>
                      <td>
                        {imageUrl ? (
                          <img className="thumb" src={imageUrl} alt={displayTitle || "Product image"} />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{displayTitle || "-"}</td>
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
