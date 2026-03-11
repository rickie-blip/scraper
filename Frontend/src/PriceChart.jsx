import { useEffect, useRef } from "react";
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler } from "chart.js";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler);

export default function PriceChart({ points, productName, currency = "USD" }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = points.map((p) => new Date(p.collected_at).toLocaleString());
    const prices = points.map((p) => p.price);
    const normalizedCurrency = String(currency || "").trim().toUpperCase();
    const safeCurrency = /^[A-Z]{3}$/.test(normalizedCurrency) ? normalizedCurrency : "USD";
    const currencyFormatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: safeCurrency,
    });

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: `${productName || "Product"} Price`,
            data: prices,
            borderColor: "#0d6efd",
            backgroundColor: "rgba(13,110,253,0.2)",
            tension: 0.25,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            ticks: {
              callback: (value) => currencyFormatter.format(value),
            },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed?.y ?? context.raw;
                return `${context.dataset.label}: ${currencyFormatter.format(value)}`;
              },
            },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [points, productName, currency]);

  if (!points.length) {
    return <div className="text-muted">No price history for selected product.</div>;
  }

  return (
    <div className="chart-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}
