// lib/regions.js

// Schlüssel für die Regionen (kannst du später erweitern)
export const REGION_KEYS = {
  ALL: 'all',
  NORTH_ADRIATIC: 'north_adriatic',
  ISTRIA: 'istria',
  KVARNER: 'kvarner',
  MID_DALMATIA: 'mid_dalmatia',
  SOUTH_DALMATIA: 'south_dalmatia',
};

// Konfiguration aller Regionen
export const REGIONS = [
  {
    key: REGION_KEYS.ALL,
    label: {
      de: 'Gesamte Adria',
      en: 'Whole Adriatic',
      hr: 'Cijeli Jadran',
    },
    north: 46.8,
    south: 40.0,
    east: 20.0,
    west: 12.0,
    centerLat: 43.5,
    centerLng: 15.0,
    zoom: 6,
  },
  {
    key: REGION_KEYS.NORTH_ADRIATIC,
    label: {
      de: 'Nordadria',
      en: 'North Adriatic',
      hr: 'Sjeverni Jadran',
    },
    north: 46.6,
    south: 44.7,
    east: 15.5,
    west: 12.0,
    centerLat: 45.5,
    centerLng: 13.5,
    zoom: 8,
  },
  {
    key: REGION_KEYS.ISTRIA,
    label: {
      de: 'Istrien',
      en: 'Istria',
      hr: 'Istra',
    },
    north: 45.6,
    south: 44.8,
    east: 14.3,
    west: 13.2,
    centerLat: 45.2,
    centerLng: 13.7,
    zoom: 9,
  },
  {
    key: REGION_KEYS.KVARNER,
    label: {
      de: 'Kvarner',
      en: 'Kvarner',
      hr: 'Kvarner',
    },
    north: 45.6,
    south: 44.3,
    east: 15.3,
    west: 13.8,
    centerLat: 45.0,
    centerLng: 14.7,
    zoom: 8.5,
  },
  {
    key: REGION_KEYS.MID_DALMATIA,
    label: {
      de: 'Mitteldalmatien',
      en: 'Central Dalmatia',
      hr: 'Srednja Dalmacija',
    },
    north: 44.3,
    south: 42.6,
    east: 17.6,
    west: 15.0,
    centerLat: 43.4,
    centerLng: 16.5,
    zoom: 8.5,
  },
  {
    key: REGION_KEYS.SOUTH_DALMATIA,
    label: {
      de: 'Süddalmatien',
      en: 'South Dalmatia',
      hr: 'Južna Dalmacija',
    },
    north: 42.7,
    south: 41.7,
    east: 18.6,
    west: 16.8,
    centerLat: 42.5,
    centerLng: 18.0,
    zoom: 9,
  },
];

// Hilfsfunktion: passende Region für einen Punkt finden
export function findRegionForPoint(lat, lng) {
  const hit = REGIONS.find(r =>
    lat <= r.north &&
    lat >= r.south &&
    lng <= r.east &&
    lng >= r.west
  );
  return hit || REGIONS[0]; // Fallback: "all"
}
