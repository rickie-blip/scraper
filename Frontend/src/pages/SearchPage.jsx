import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { loadPersistedState, savePersistedState } from "../utils/persist";
import { downloadCsv } from "../utils/csv";
import { CATEGORY_TREE } from "../categoryData";

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

function resolveCurrency(item, competitorByName, fallbackCurrency) {
  if (item?.currency) return item.currency;
  if (item?.original_currency) return item.original_currency;
  const brand = item?.brand ? competitorByName.get(item.brand) : null;
  return brand?.currency || fallbackCurrency || null;
}

const PAGE_SIZE = 50;

export default function SearchPage() {
  const { id: routeCompetitorId } = useParams();
  const [params] = useSearchParams();
  const routeQuery = params.get("q") || "";
  const [competitors, setCompetitors] = useState([]);
  const [searchCompetitorId, setSearchCompetitorId] = useState("");
  const [category, setCategory] = useState("dresses");
  const [subcategory, setSubcategory] = useState("dresses");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [openCategoryKey, setOpenCategoryKey] = useState("dresses");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [page, setPage] = useState(1);
  const [detailView, setDetailView] = useState(false);
  const categoryRef = useRef(null);

  const categories = CATEGORY_TREE;
  const competitorByName = useMemo(
    () => new Map(competitors.map((item) => [item.name, item])),
    [competitors]
  );
  const selectedCompetitor = useMemo(
    () => competitors.find((item) => String(item.id) === String(searchCompetitorId)),
    [competitors, searchCompetitorId]
  );
  const groupedResults = useMemo(() => {
    if (!searchResult?.data?.length) return [];
    const map = new Map();
    for (const item of searchResult.data) {
      const key = item.brand || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return Array.from(map.entries())
      .map(([brand, items]) => ({ brand, items }))
      .sort((a, b) => {
        const countDiff = b.items.length - a.items.length;
        if (countDiff !== 0) return countDiff;
        return a.brand.localeCompare(b.brand);
      });
  }, [searchResult]);
  const defaultCurrency = selectedCompetitor?.currency || null;
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((searchResult?.data?.length || 0) / PAGE_SIZE)),
    [searchResult]
  );
  const pagedItems = useMemo(() => {
    const items = searchResult?.data || [];
    const start = (page - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }, [page, searchResult]);

  useEffect(() => {
    let active = true;
    api
      .getCompetitors()
      .then((data) => {
        if (!active) return;
        setCompetitors(data);
        if (data.length) {
          setSearchCompetitorId("all");
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
    const saved = loadPersistedState("search");
    if (!saved || searchResult) return;
    if (saved.query) setSearchQuery(saved.query);
    if (saved.competitor_id) setSearchCompetitorId(String(saved.competitor_id));
    if (saved.result) setSearchResult(saved.result);
  }, [searchResult]);

  useEffect(() => {
    if (!searchCompetitorId) return;
    if (searchResult || searchQuery) return;
    setSearchQuery(subcategory || category);
  }, [searchCompetitorId]);

  useEffect(() => {
    if (searchResult || searchQuery) return;
    setSearchQuery(subcategory || category);
  }, [category, subcategory]);

  useEffect(() => {
    if (!routeCompetitorId) {
      setDetailView(false);
      return;
    }
    setDetailView(true);
    setSearchCompetitorId(String(routeCompetitorId));
    if (routeQuery) {
      setSearchQuery(routeQuery);
    }
  }, [routeCompetitorId, routeQuery]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (!categoryMenuOpen) return;
      if (categoryRef.current && !categoryRef.current.contains(event.target)) {
        setCategoryMenuOpen(false);
        setOpenCategoryKey("");
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [categoryMenuOpen]);

  async function runSearch({ persist = true } = {}) {
    setSearchLoading(true);
    setSearchError("");
    setSearchResult(null);
    setPage(1);
    try {
      if (searchCompetitorId === "all") {
        const requests = competitors.map((competitor) =>
          api.searchCompetitor(competitor.id, searchQuery, { persist })
        );
        const results = await Promise.allSettled(requests);
        const combined = {
          success: true,
          count: 0,
          data: [],
          failed: [],
        };

        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            const payload = result.value;
            const items = payload?.data || [];
            combined.data.push(...items);
            combined.count += items.length;
          } else {
            combined.failed.push(competitors[index]?.name || `Competitor ${index + 1}`);
          }
        });

        setSearchResult(combined);
        savePersistedState("search", {
          competitor_id: "all",
          competitor_name: "All competitors",
          query: searchQuery,
          result: combined,
          updated_at: new Date().toISOString(),
        });
      } else {
        const res = await api.searchCompetitor(searchCompetitorId, searchQuery, { persist });
        setSearchResult(res);
        savePersistedState("search", {
          competitor_id: searchCompetitorId,
          query: searchQuery,
          result: res,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearchLoading(false);
    }
  }

  async function onSearchSubmit(e) {
    e.preventDefault();
    await runSearch({ persist: true });
  }

  useEffect(() => {
    if (!detailView) return;
    if (!routeCompetitorId || !routeQuery) return;
    runSearch({ persist: false });
  }, [detailView, routeCompetitorId, routeQuery]);

  function exportResults() {
    if (!searchResult?.data?.length) return;
    const rows = searchResult.data.map((item) => ({
      brand: item.brand,
      title: item.title,
      price: item.price,
      image: resolveImage(item),
      url: item.url,
    }));
    const label = searchCompetitorId === "all" ? "all-competitors" : searchCompetitorId || "competitor";
    downloadCsv(`search-${label}.csv`, rows);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>{detailView ? "Full Search Results" : "Shopify Search Console"}</h2>
          {detailView ? (
            <p>
              {selectedCompetitor?.name || "Competitor"} results for <strong>{searchQuery || routeQuery || "search"}</strong>
            </p>
          ) : (
            <p>Search any competitor that you have added in the tracker.</p>
          )}
        </div>
        {detailView && (
          <div className="row-actions">
            <Link className="btn btn-outline-secondary" to="/search">
              Back to Search
            </Link>
            <button className="btn btn-outline-primary" onClick={exportResults} disabled={!searchResult?.data?.length}>
              Export CSV
            </button>
          </div>
        )}
      </div>
      {!detailView && (
        <form className="grid-row" onSubmit={onSearchSubmit}>
        <div className="category-dropdown" ref={categoryRef}>
          <button
            className="btn btn-outline-secondary category-toggle"
            type="button"
            onClick={() => setCategoryMenuOpen((open) => !open)}
          >
            Category: {category ? categories.find((c) => c.key === category)?.label || "Dresses" : "All categories"}
            <span className="caret">▾</span>
          </button>
          {categoryMenuOpen && (
            <div className="category-menu">
              <div className="category-item">
                <button
                  type="button"
                  className="category-choice"
                  onClick={() => {
                    setCategory("");
                    setSubcategory("");
                    setCategoryMenuOpen(false);
                    setOpenCategoryKey("");
                  }}
                >
                  All categories
                </button>
              </div>
              {categories.map((item) => (
                <div key={item.key} className="category-item">
                  <button
                    type="button"
                    className="category-choice"
                    onClick={() => {
                      setCategory(item.key);
                      setOpenCategoryKey((current) => (current === item.key ? "" : item.key));
                      if (!item.subcategories?.length) {
                        setSubcategory(item.key);
                        setCategoryMenuOpen(false);
                      } else if (item.subcategories.length) {
                        setSubcategory(item.subcategories[0].value);
                      }
                    }}
                  >
                    {item.label}
                    {item.subcategories?.length ? <span className="caret">▾</span> : null}
                  </button>
                  {item.subcategories?.length && openCategoryKey === item.key && (
                    <div className="subcategory-menu">
                      {item.subcategories.map((sub) => (
                        <button
                          key={sub.value}
                          type="button"
                          className="subcategory-choice"
                          onClick={() => {
                            setCategory(item.key);
                            setSubcategory(sub.value);
                            setCategoryMenuOpen(false);
                            setOpenCategoryKey("");
                          }}
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <select
          className="form-select"
          value={searchCompetitorId}
          onChange={(e) => setSearchCompetitorId(e.target.value)}
          required
        >
          <option value="all">All competitors</option>
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
      )}

      {!detailView && (
        <div className="row-actions">
          <button className="btn btn-outline-primary btn-sm" onClick={exportResults} disabled={!searchResult?.data?.length}>
            Export CSV
          </button>
        </div>
      )}

      {searchError && <div className="alert alert-warning mt-2">{searchError}</div>}
      {searchResult && (
        <div className="search-results mt-3">
          {detailView ? (
            <>
              <div className="table-actions">
                <div className="muted">
                  Showing {pagedItems.length} of {searchResult.data?.length || 0} items
                </div>
                {searchResult.data?.length > PAGE_SIZE && (
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
                      const displayCurrency = resolveCurrency(item, competitorByName, defaultCurrency);
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
                          <td>{formatPriceWithOriginal(item, displayCurrency)}</td>
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
          ) : searchCompetitorId === "all" ? (
            <div className="results-grid">
              {groupedResults.map((group) => {
                const competitor = competitorByName.get(group.brand);
                const viewMorePath = competitor
                  ? `/search/competitor/${competitor.id}?q=${encodeURIComponent(searchQuery)}`
                  : null;
                const visibleItems = group.items.slice(0, 10);

                return (
                  <div className="competitor-card" key={group.brand}>
                    <div className="competitor-header">
                      <div>
                        <div className="competitor-title">{group.brand}</div>
                        <div className="competitor-meta">{group.items.length} results</div>
                      </div>
                      {viewMorePath && group.items.length > 10 && (
                        <Link className="btn btn-outline-primary btn-sm" to={viewMorePath}>
                          View more
                        </Link>
                      )}
                    </div>
                    <div className="product-grid">
                      {visibleItems.map((item, idx) => {
                        const imageUrl = resolveImage(item);
                        const displayCurrency = resolveCurrency(
                          item,
                          competitorByName,
                          defaultCurrency
                        );
                        return (
                          <div className="product-card" key={`${item.url}-${idx}`}>
                            <div className="product-media">
                              {imageUrl ? (
                                <img src={imageUrl} alt={item.title} loading="lazy" />
                              ) : (
                                <div className="product-placeholder">No image</div>
                              )}
                            </div>
                            <div className="product-body">
                              <div className="product-title">{item.title}</div>
                              <div className="product-price">
                                {formatPriceWithOriginal(item, displayCurrency)}
                              </div>
                              {item.url && (
                                <a className="product-link" href={item.url} rel="noreferrer" target="_blank">
                                  Open
                                  <span aria-hidden="true">↗</span>
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {!visibleItems.length && (
                        <div className="text-muted">No results returned.</div>
                      )}
                    </div>
                  </div>
                );
              })}
              {!groupedResults.length && (
                <div className="text-muted">No results returned.</div>
              )}
            </div>
          ) : (
            <div className="single-competitor">
              <div className="table-actions">
                <div>
                  <strong>{selectedCompetitor?.name || "Competitor"} results</strong>
                  <div className="muted">{searchResult.data?.length || 0} items found</div>
                </div>
                {searchResult.data?.length > 10 && searchCompetitorId && (
                  <Link
                    className="btn btn-outline-primary btn-sm"
                    to={`/search/competitor/${searchCompetitorId}?q=${encodeURIComponent(searchQuery)}`}
                  >
                    View more
                  </Link>
                )}
              </div>
              <div className="product-grid">
                {searchResult.data?.slice(0, 10).map((item, idx) => {
                  const imageUrl = resolveImage(item);
                  const displayCurrency = resolveCurrency(item, competitorByName, defaultCurrency);
                  return (
                    <div className="product-card" key={`${item.url}-${idx}`}>
                      <div className="product-media">
                        {imageUrl ? (
                          <img src={imageUrl} alt={item.title} loading="lazy" />
                        ) : (
                          <div className="product-placeholder">No image</div>
                        )}
                      </div>
                      <div className="product-body">
                        <div className="product-title">{item.title}</div>
                        <div className="product-price">
                          {formatPriceWithOriginal(item, displayCurrency)}
                        </div>
                        {item.url && (
                          <a className="product-link" href={item.url} rel="noreferrer" target="_blank">
                            Open
                            <span aria-hidden="true">↗</span>
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!searchResult.data?.length && (
                  <div className="text-muted">No results returned.</div>
                )}
              </div>
            </div>
          )}
          {searchResult.failed?.length > 0 && (
            <div className="alert alert-warning mt-2">
              Failed searches: {searchResult.failed.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
