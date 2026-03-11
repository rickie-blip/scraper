import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { downloadCsv } from "../utils/csv";
import { CATEGORY_TREE } from "../categoryData";

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
  const [category, setCategory] = useState("dresses");
  const [subcategory, setSubcategory] = useState("dresses");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [openCategoryKey, setOpenCategoryKey] = useState("dresses");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState("");
  const categoryRef = useRef(null);

  const categories = CATEGORY_TREE;

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
    if (!searchCompetitorId) return;
    setSearchQuery(subcategory || category);
  }, [searchCompetitorId]);

  useEffect(() => {
    setSearchQuery(subcategory || category);
  }, [category, subcategory]);

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

  async function onSearchSubmit(e) {
    e.preventDefault();
    setSearchLoading(true);
    setSearchError("");
    setSearchResult(null);
    try {
      if (searchCompetitorId === "all") {
        const requests = competitors.map((competitor) =>
          api.searchCompetitor(competitor.id, searchQuery, { persist: true })
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
      } else {
        const res = await api.searchCompetitor(searchCompetitorId, searchQuery, { persist: true });
        setSearchResult(res);
      }
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
    const label = searchCompetitorId === "all" ? "all-competitors" : searchCompetitorId || "competitor";
    downloadCsv(`search-${label}.csv`, rows);
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
        <div className="category-dropdown" ref={categoryRef}>
          <button
            className="btn btn-outline-secondary category-toggle"
            type="button"
            onClick={() => setCategoryMenuOpen((open) => !open)}
          >
            Category: {categories.find((c) => c.key === category)?.label || "Dresses"}
            <span className="caret">▾</span>
          </button>
          {categoryMenuOpen && (
            <div className="category-menu">
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

      <div className="row-actions">
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
