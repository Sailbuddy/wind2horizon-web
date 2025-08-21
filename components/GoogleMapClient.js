// components/GoogleMapClient.js

"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// === Supabase Client ===
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// === Helper: escape HTML ===
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#039;";
      default: return m;
    }
  });
}

// === Helper: Repair Mojibake ===
function repairMojibake(s = "") {
  return /Ã|Å|Â/.test(s) ? decodeURIComponent(escape(s)) : s;
}

// === FIELD MAP (canonical names by attribute_id) ===
const FIELD_MAP_BY_ID = {
  5: "address",
  17: "photo",
  25: "website",
  26: "rating_total",
  27: "rating",
  28: "address",           // multiple address variants
  29: "website",
  30: "phone",
  37: "opening_hours",
  38: "opening_hours",
  39: "opening_hours",
  40: "opening_hours",
  41: "opening_hours",
  42: "opening_hours",
  43: "opening_hours",
};

// === Pick name from locations table ===
function pickNameFromRow(row, lang) {
  let raw =
    (lang === "de" && row.name_de) ||
    (lang === "it" && row.name_it) ||
    (lang === "fr" && row.name_fr) ||
    (lang === "hr" && row.name_hr) ||
    (lang === "en" && row.name_en) ||
    row.display_name ||
    "";
  return repairMojibake(raw);
}

// === Pick description from locations table ===
function pickDescriptionFromRow(row, lang) {
  return (
    (lang === "de" && row.description_de) ||
    (lang === "it" && row.description_it) ||
    (lang === "fr" && row.description_fr) ||
    (lang === "hr" && row.description_hr) ||
    (lang === "en" && row.description_en) ||
    ""
  );
}

// === Build InfoWindow Content ===
function buildInfoContent(row, kv, lang) {
  const name = escapeHtml(pickNameFromRow(row, lang));
  const desc = escapeHtml(pickDescriptionFromRow(row, lang) || kv.description || "");

  // address language selection
  const addrByLang = kv.addressByLang || {};
  const pref = [lang, "de", "en", "it", "fr", "hr"];
  let addrSel = "";
  for (const L of pref) if (addrByLang[L]) { addrSel = addrByLang[L]; break; }
  const address = escapeHtml(addrSel || kv.address || "");

  // rating
  const ratingHtml = kv.rating
    ? `<div class="iw-rating">⭐ ${kv.rating} (${kv.rating_total || ""})</div>`
    : "";

  // opening hours
  let openingHtml = "";
  const hoursByLang = kv.hoursByLang || {};
  let hoursArr = null;
  for (const L of pref) if (hoursByLang[L]?.length) { hoursArr = hoursByLang[L]; break; }
  if (hoursArr && hoursArr.length) {
    openingHtml +=
      '<ul class="iw-hours">' +
      hoursArr.map((h) => `<li>${escapeHtml(String(h))}</li>`).join("") +
      "</ul>";
  }

  // website / phone
  const websiteBtn = kv.website
    ? `<a href="${kv.website}" target="_blank" class="iw-btn">🌐 Website</a>`
    : "";
  const phoneBtn = kv.phone
    ? `<a href="tel:${kv.phone}" class="iw-btn">📞 Anrufen</a>`
    : "";

  const routeBtn = `<a href="https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}" target="_blank" class="iw-btn">🧭 Route</a>`;

  return `
    <div class="iw-content">
      <h3>${name}</h3>
      <p>📍 ${address}</p>
      ${ratingHtml}
      <p>${desc}</p>
      ${openingHtml}
      <div class="iw-buttons">${routeBtn} ${websiteBtn} ${phoneBtn}</div>
    </div>
  `;
}

// === Main Component ===
export default function GoogleMapClient({ lang = "de" }) {
  const mapRef = useRef(null);

  useEffect(() => {
    let map;
    let infoWindow;
    async function initMap() {
      // load Google Maps
      const loader = new window.google.maps.plugins.loader.Loader({
        apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
        version: "weekly",
      });
      await loader.load();

      map = new google.maps.Map(mapRef.current, {
        center: { lat: 47.5, lng: 13.3 },
        zoom: 6,
      });
      infoWindow = new google.maps.InfoWindow();

      // fetch categories
      const { data: categories } = await supabase.from("categories").select("*");

      // fetch locations
      const { data: locations } = await supabase
        .from("locations")
        .select(`id,lat,lng,category_id,display_name,
                 name_de,name_en,name_it,name_fr,name_hr,
                 description_de,description_en,description_it,description_fr,description_hr,
                 categories:category_id ( icon_svg )`);

      // fetch values
      const { data: kvRows } = await supabase.from("location_values").select("*");

      // transform kvRows -> kvByLocation
      const kvByLocation = {};
      for (const r of kvRows) {
        const locId = r.location_id;
        if (!kvByLocation[locId]) kvByLocation[locId] = {};
        const obj = kvByLocation[locId];
        const canon = FIELD_MAP_BY_ID[r.attribute_id];
        const val = r.value_text || r.value_option || r.value_number || "";

        const lc = (r.language_code || "").toLowerCase();

        if (canon === "opening_hours") {
          obj.hoursByLang = obj.hoursByLang || {};
          const v = r.value_json ?? r.value_text ?? "";
          const arr = Array.isArray(v)
            ? v
            : typeof v === "string" && v.trim().startsWith("[")
            ? JSON.parse(v)
            : null;
          if (arr)
            obj.hoursByLang[lc] = (obj.hoursByLang[lc] || []).concat(arr);
          else
            obj.hoursByLang[lc] = (obj.hoursByLang[lc] || []).concat(
              String(v).split("\n")
            );
        } else if (canon === "address") {
          obj.addressByLang = obj.addressByLang || {};
          if (lc) obj.addressByLang[lc] = obj.addressByLang[lc] || String(val);
          else obj.address = obj.address || String(val);
        } else if (canon) {
          obj[canon] = val;
        }
      }

      // place markers
      locations.forEach((row) => {
        const kv = kvByLocation[row.id] || {};
        const marker = new google.maps.Marker({
          position: { lat: row.lat, lng: row.lng },
          map,
        });
        marker.addListener("click", () => {
          const content = buildInfoContent(row, kv, lang);
          infoWindow.setContent(content);
          infoWindow.open(map, marker);
          console.log("[w2h] kvForLocation", row.id, kv);
        });
      });
    }

    initMap();
  }, [lang]);

  return <div ref={mapRef} style={{ width: "100%", height: "80vh" }} />;
}
