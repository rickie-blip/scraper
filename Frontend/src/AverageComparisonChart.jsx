import { useEffect, useRef } from "react";
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "KSH") return "KES";
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "KES";
}

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

export default function AverageComparisonChart({ rows, currency = "USD" }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = rows.map((row) => row.competitor);
    const values = rows.map((row) => row.avg_price ?? 0);
    const colors = labels.map((label) => colorForLabel(label));
    const safeCurrency = normalizeCurrency(currency);
    const currencyFormatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: safeCurrency,
    });

    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Average Price",
            data: values,
            backgroundColor: colors,
            borderColor: colors,
            borderWidth: 1,
            borderRadius: 14,
            barThickness: 60,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: { top: 2, left: 0, right: 0, bottom: 0 },
        },
        scales: {
          x: {
            grid: {
              display: false,
            },
          },
          y: {
            grid: {
              color: "rgba(148, 163, 184, 0.35)",
              borderDash: [4, 4],
            },
            ticks: {
              callback: (value) => currencyFormatter.format(value),
              maxTicksLimit: 6,
              autoSkip: true,
              padding: 6,
            },
            beginAtZero: true,
            stepSize: 1000,
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (context) =>
                `${context.dataset.label}: ${currencyFormatter.format(context.parsed?.y ?? 0)}`,
            },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [rows, currency]);

  if (!rows.length) {
    return <div className="text-muted">No comparison data yet.</div>;
  }

  return (
    <div className="chart-wrap">
      <canvas ref={canvasRef} />
      <div className="chart-legend">
        {rows.map((row) => (
          <div className="legend-item" key={row.competitor}>
            <span
              className="legend-swatch"
              style={{ backgroundColor: colorForLabel(row.competitor) }}
            />
            <span>{row.competitor}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
