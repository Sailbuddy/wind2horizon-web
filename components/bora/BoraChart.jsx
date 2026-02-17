'use client';

import { useEffect, useRef } from 'react';

export default function BoraChart({ title, labels, data }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    let alive = true;

    async function init() {
      const { Chart, registerables } = await import('chart.js');
      const annotationMod = await import('chartjs-plugin-annotation');
      const annotationPlugin = annotationMod?.default || annotationMod;

      Chart.register(...registerables);
      Chart.register(annotationPlugin);

      if (!alive || !canvasRef.current) return;

      // destroy old
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }

      const ctx = canvasRef.current.getContext('2d');

      chartRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'ΔP (Triest–Maribor)',
            data,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37,99,235,.15)',
            pointBackgroundColor: '#fff',
            pointBorderColor: '#2563eb',
            pointRadius: 3,
            borderWidth: 2,
            tension: 0.35,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { min: -15, max: 5, ticks: { stepSize: 2 } },
          },
          plugins: {
            legend: { display: false },
            annotation: {
              annotations: {
                line0: { type: 'line', yMin: 0, yMax: 0, borderColor: '#0284c7', borderWidth: 2 },
                line4: { type: 'line', yMin: -4, yMax: -4, borderColor: '#f59e0b', borderWidth: 2 },
                line8: { type: 'line', yMin: -8, yMax: -8, borderColor: '#ef4444', borderWidth: 2 },
              },
            },
          },
        },
      });
    }

    init();

    return () => {
      alive = false;
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [labels, data]);

  return (
    <div className="w-full">
      {title ? <div className="text-lg font-bold text-slate-900 mb-2">{title}</div> : null}
      <div className="w-full h-[360px] md:h-[420px]">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
