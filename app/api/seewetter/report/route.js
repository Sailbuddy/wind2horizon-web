// app/api/seewetter/report/route.js
export const runtime = 'nodejs';

export async function GET() {
  const url =
    'https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_n';

  const res = await fetch(url, {
    headers: {
      // hilft gegen einfache Bot-Blocker
      'user-agent':
        'Mozilla/5.0 (Wind2Horizon Seewetter Proxy) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
      accept: 'text/html,*/*',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    return Response.json(
      { ok: false, status: res.status, statusText: res.statusText },
      { status: 502 }
    );
  }

  const html = await res.text();

  return Response.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    source: url,
    html,
  });
}
