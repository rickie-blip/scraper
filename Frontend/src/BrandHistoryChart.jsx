import { useEffect, useRef } from "react";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler);

const BRAND_PALETTE = [
  "#ff6b4a",
  "#1f7cff",
  "#14b8a6",
  "#f59e0b",
  "#7c3aed",
  "#ec4899",
  "#22c55e",
  "#0ea5e9",
  "#f97316",
  "#334155",
];

function colorForLabel(label) {
  const text = String(label || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 997;
  }
  return BRAND_PALETTE[hash % BRAND_PALETTE.length];
}

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "KSH") return "KES";
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "KES";
}

export default function BrandHistoryChart({ labels, series, currency = "KES" }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const safeCurrency = normalizeCurrency(currency);
    const currencyFormatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: safeCurrency,
    });

    const datasets = series.map((item) => {
      const color = colorForLabel(item.brand);
      return {
        label: item.brand,
        data: (item.data || []).map((value) =>
          value == null ? null : Math.max(0, Number(value) || 0)
        ),
        borderColor: color,
        backgroundColor: `${color}33`,
        tension: 0.25,
        fill: false,
        spanGaps: true,
        pointRadius: 3,
        pointHoverRadius: 4,
      };
    });

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            suggestedMin: 0,
            ticks: {
              callback: (value) => currencyFormatter.format(value),
            },
          },
        },
        plugins: {
          legend: {
            position: "bottom",
          },
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
  }, [labels, series, currency]);

  if (!series.length || !labels.length) {
    return <div className="text-muted">No history data yet.</div>;
  }

  return (
    <div className="chart-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}
