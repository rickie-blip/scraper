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
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "USD";
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
    const overallAverage =
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;
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
            label: "Avg Price per Competitor",
            data: values,
            backgroundColor: "rgba(255, 107, 74, 0.65)",
            borderColor: "rgba(255, 107, 74, 1)",
            borderWidth: 1,
          },
          {
            type: "line",
            label: "Category Average (All Competitors)",
            data: labels.map(() => overallAverage),
            borderColor: "rgba(31, 124, 255, 0.9)",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
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
    </div>
  );
}
