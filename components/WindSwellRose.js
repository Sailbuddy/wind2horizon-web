// components/WindSwellRose.js
import React from 'react';

// Acht Richtungen
const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

const ANGLE = {
  N: 0,
  NO: 45,
  O: 90,
  SO: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

export default function WindSwellRose({
  size = 280,
  editMode = false,
  wind,
  swell,
  onChange,
  labels = true,
  colors = {
    windActive: '#E53E3E',   // Rot
    swellActive: '#2563EB',  // Blau
    inactive: '#C7C7C7',     // Grau für Pfeile
    ring: '#AFAFAF',         // Grau für Ringe
    label: '#111111',        // Schwarz
  },
}) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.40;
  const innerR = size * 0.24;
  const arrowL = size * 0.085;
  const arrowW = size * 0.06;

  const arrow = (deg, r) => {
    // 0° = Norden
    const rad = (deg - 90) * Math.PI / 180;
    const tipX = cx + Math.cos(rad) * (r - arrowL);
    const tipY = cy + Math.sin(rad) * (r - arrowL);
    const baseX = cx + Math.cos(rad) * r;
    const baseY = cy + Math.sin(rad) * r;
    const nx = Math.cos(rad + Math.PI / 2) * (arrowW / 2);
    const ny = Math.sin(rad + Math.PI / 2) * (arrowW / 2);
    return `${tipX},${tipY} ${baseX - nx},${baseY - ny} ${baseX + nx},${baseY + ny}`;
  };

  const toggle = (kind, d) => {
    if (!editMode || !onChange) return;
    onChange({
      wind: {
        ...wind,
        ...(kind === 'wind' ? { [d]: !wind?.[d] } : {}),
      },
      swell: {
        ...swell,
        ...(kind === 'swell' ? { [d]: !swell?.[d] } : {}),
      },
    });
  };

  const safeWind = wind || {};
  const safeSwell = swell || {};

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="Wind & Schwell"
    >
      {/* Ringe (grau) */}
      <circle
        cx={cx}
        cy={cy}
        r={outerR}
        fill="none"
        stroke={colors.ring}
        strokeWidth={size * 0.03}
      />
      <circle
        cx={cx}
        cy={cy}
        r={innerR}
        fill="none"
        stroke={colors.ring}
        strokeWidth={size * 0.025}
      />

      {/* Pfeile außen: Wind (rot) */}
      {DIRS.map((d) => (
        <polygon
          key={`w-${d}`}
          points={arrow(ANGLE[d], outerR)}
          fill={safeWind[d] ? colors.windActive : colors.inactive}
          style={{ cursor: editMode ? 'pointer' : 'default' }}
          onClick={() => toggle('wind', d)}
        >
          <title>{`Gefahr bei WIND aus ${d}`}</title>
        </polygon>
      ))}

      {/* Pfeile innen: Schwell (blau) */}
      {DIRS.map((d) => (
        <polygon
          key={`s-${d}`}
          points={arrow(ANGLE[d], innerR)}
          fill={safeSwell[d] ? colors.swellActive : colors.inactive}
          style={{ cursor: editMode ? 'pointer' : 'default' }}
          onClick={() => toggle('swell', d)}
        >
          <title>{`Gefahr bei SCHWELL aus ${d}`}</title>
        </polygon>
      ))}

      {/* Labels */}
      {labels &&
        DIRS.map((d) => {
          const r = outerR + size * 0.08;
          const rad = (ANGLE[d] - 90) * Math.PI / 180;
          const tx = cx + Math.cos(rad) * r;
          const ty = cy + Math.sin(rad) * r;
          return (
            <text
              key={`lbl-${d}`}
              x={tx}
              y={ty}
              fontFamily="system-ui, sans-serif"
              fontSize={size * 0.07}
              fill={colors.label}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {d}
            </text>
          );
        })}
    </svg>
  );
}
