const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

export const api = {
  getSummary: () => request("/dashboard/summary"),
  getCompetitors: () => request("/competitors"),
  addCompetitor: (payload) => request("/competitors", { method: "POST", body: JSON.stringify(payload) }),
  getProducts: () => request("/products"),
  addProduct: (payload) => request("/products", { method: "POST", body: JSON.stringify(payload) }),
  scrapeProduct: (productId) => request(`/products/${productId}/scrape`, { method: "POST" }),
  scrapeAll: () => request("/scrape/run", { method: "POST" }),
  getHistory: (productId) => request(`/products/${productId}/history`),
  getComparison: ({ base_competitor, category }) => {
    const params = new URLSearchParams();
    if (base_competitor) params.set("base_competitor", base_competitor);
    if (category) params.set("category", category);
    return request(`/comparison?${params.toString()}`);
  },
};
