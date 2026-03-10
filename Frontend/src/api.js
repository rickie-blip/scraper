const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";
const PUBLIC_BASE = import.meta.env.VITE_PUBLIC_BASE || "http://localhost:5000";

async function request(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

const apiRequest = (path, options) => request(API_BASE, path, options);
const publicRequest = (path, options) => request(PUBLIC_BASE, path, options);

export const api = {
  health: () => apiRequest("/health"),
  getSummary: () => apiRequest("/dashboard/summary"),
  getCompetitors: () => apiRequest("/competitors"),
  addCompetitor: (payload) => apiRequest("/competitors", { method: "POST", body: JSON.stringify(payload) }),
  getProducts: () => apiRequest("/products"),
  addProduct: (payload) => apiRequest("/products", { method: "POST", body: JSON.stringify(payload) }),
  scrapeProduct: (productId) => apiRequest(`/products/${productId}/scrape`, { method: "POST" }),
  scrapeAll: () => apiRequest("/scrape/run", { method: "POST" }),
  getHistory: (productId) => apiRequest(`/products/${productId}/history`),
  getComparison: ({ base_competitor, category }) => {
    const params = new URLSearchParams();
    if (base_competitor) params.set("base_competitor", base_competitor);
    if (category) params.set("category", category);
    return apiRequest(`/comparison?${params.toString()}`);
  },
  liveCompare: (payload) => apiRequest("/live-compare", { method: "POST", body: JSON.stringify(payload) }),

  searchVivoBodycons: (q) => publicRequest(`/search-vivo-bodycons?q=${encodeURIComponent(q)}`),
  searchNalaniBodycons: (q) => publicRequest(`/search-nalani-bodycons?q=${encodeURIComponent(q)}`),
  searchNeviiveBodycons: (q) => publicRequest(`/search-neviive-bodycons?q=${encodeURIComponent(q)}`),
  searchDiracBodycons: (q) => publicRequest(`/search-dirac-bodycons?q=${encodeURIComponent(q)}`),

  searchVivoBodysuits: (q) => publicRequest(`/search-vivo-bodysuits?q=${encodeURIComponent(q)}`),
  searchNalaniBodysuits: (q) => publicRequest(`/search-nalani-bodysuits?q=${encodeURIComponent(q)}`),
  searchNeviiveBodysuits: (q) => publicRequest(`/search-neviive-bodysuits?q=${encodeURIComponent(q)}`),
  searchDiracBodysuits: (q) => publicRequest(`/search-dirac-bodysuits?q=${encodeURIComponent(q)}`),

  searchVivoDresses: (q) => publicRequest(`/search-vivo-dresses?q=${encodeURIComponent(q)}`),
  searchNalaniDresses: (q) => publicRequest(`/search-nalani-dresses?q=${encodeURIComponent(q)}`),
  searchNeviiveDresses: (q) => publicRequest(`/search-neviive-dresses?q=${encodeURIComponent(q)}`),
  searchDiracDresses: (q) => publicRequest(`/search-dirac-dresses?q=${encodeURIComponent(q)}`),

  scrapeVivoDressesCollection: (url) => {
    const param = url ? `?url=${encodeURIComponent(url)}` : "";
    return publicRequest(`/scrape-vivo-dresses-collection${param}`);
  },
  scrapeNeviiveDressesCollection: (url) => {
    const param = url ? `?url=${encodeURIComponent(url)}` : "";
    return publicRequest(`/scrape-neviive-dresses-collection${param}`);
  },
  ikojnDresses: (url) => {
    const param = url ? `?url=${encodeURIComponent(url)}` : "";
    return publicRequest(`/ikojn-dresses${param}`);
  },
  nalaniDressesCollection: (url) => {
    const param = url ? `?url=${encodeURIComponent(url)}` : "";
    return publicRequest(`/nalani-dresses-collection${param}`);
  },
};
