// /lib/utils.js

// wandelt ein SVG-String in eine Data-URL um, die Google Maps als Icon versteht
export function svgToDataUrl(svg) {
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent((svg || '').trim());
}