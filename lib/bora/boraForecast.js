export async function fetchBoraDeltaSeries() {
  const mariborLat = 46.55, mariborLon = 15.65;
  const triestLat  = 45.65, triestLon  = 13.77;

  const now = new Date();
  const startDate = now.toISOString().slice(0, 10);
  const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const mariborUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${mariborLat}&longitude=${mariborLon}` +
    `&hourly=pressure_msl&start_date=${startDate}&end_date=${endDate}&timezone=UTC`;

  const triestUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${triestLat}&longitude=${triestLon}` +
    `&hourly=pressure_msl,windspeed_10m,winddirection_10m&start_date=${startDate}&end_date=${endDate}&timezone=UTC`;

  const [mResp, tResp] = await Promise.all([fetch(mariborUrl), fetch(triestUrl)]);
  if (!mResp.ok) throw new Error(`Maribor fetch failed: ${mResp.status}`);
  if (!tResp.ok) throw new Error(`Triest fetch failed: ${tResp.status}`);

  const mariborData = await mResp.json();
  const triestData = await tResp.json();

  const mP = mariborData?.hourly?.pressure_msl || [];
  const tP = triestData?.hourly?.pressure_msl || [];
  const times = mariborData?.hourly?.time || [];

  const ws = triestData?.hourly?.windspeed_10m || [];
  const wd = triestData?.hourly?.winddirection_10m || [];

  const nowTs = now.getTime();

  const points = times.map((t, i) => {
    // ⚠️ Open-Meteo time ist meist ohne "Z" -> als UTC erzwingen
    const d = new Date(t + 'Z');
    const delta = tP[i] - mP[i];

    return {
      timeUtc: t,
      ts: d.getTime(),
      hourUtc: d.getUTCHours(),
      day: d.getUTCDate(),
      month: d.getUTCMonth() + 1,
      delta: Number(delta.toFixed(1)),
      triestPressure: tP[i],
      mariborPressure: mP[i],
      triestWindKmh: ws[i],
      triestWindDir: wd[i],
    };
  });

  return { nowTs, points };
}

export function buildBoraCharts({ nowTs, points }) {
  const labelsWeek = [];
  const valuesWeek = [];
  const labels48h = [];
  const values48h = [];

  const horizon48 = nowTs + 48 * 60 * 60 * 1000;
  const horizon36 = nowTs + 36 * 60 * 60 * 1000;

  let minDelta36 = Infinity;

  // „Now“-Punkt: der zeitlich nächste Punkt zu nowTs
  let bestNowIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < points.length; i++) {
    const diff = Math.abs(points[i].ts - nowTs);
    if (diff < bestDiff) { bestDiff = diff; bestNowIdx = i; }
  }

  for (const p of points) {
    // next36h min
    if (p.ts >= nowTs && p.ts <= horizon36) {
      if (p.delta < minDelta36) minDelta36 = p.delta;
    }

    // charts: 0/6/12/18
    const isTick = [0, 6, 12, 18].includes(p.hourUtc);
    if (!isTick) continue;

    const label = (p.hourUtc === 0)
      ? String(p.day).padStart(2, '0') + '.' + String(p.month).padStart(2, '0')
      : String(p.hourUtc).padStart(2, '0');

    labelsWeek.push(label);
    valuesWeek.push(p.delta);

    if (p.ts <= horizon48) {
      labels48h.push(label);
      values48h.push(p.delta);
    }
  }

  if (minDelta36 === Infinity) minDelta36 = 0;

  const level =
    (minDelta36 <= -8) ? 'storm' :
    (minDelta36 <= -4) ? 'bora' :
    (minDelta36 < 0) ? 'watch' : 'none';

  const nowPoint = points[bestNowIdx];
  const windKn = nowPoint?.triestWindKmh != null
    ? Number((nowPoint.triestWindKmh / 1.852).toFixed(1))
    : null;

  return {
    week: { labels: labelsWeek, data: valuesWeek },
    h48: { labels: labels48h, data: values48h },
    next36h: { minDelta: Number(minDelta36.toFixed(1)), level },
    now: nowPoint ? {
      timeUtc: nowPoint.timeUtc,
      triestPressure: nowPoint.triestPressure,
      mariborPressure: nowPoint.mariborPressure,
      delta: nowPoint.delta,
      windKn,
      windDir: nowPoint.triestWindDir,
    } : null,
  };
}
