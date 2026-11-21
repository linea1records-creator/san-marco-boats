// unClick — fermate rimanenti di una corsa ACTV/Alilaguna (orari ufficiali GTFS)
// ?linea=1&dir=Lido&la=45.43&lo=12.33&t=1150&nx=Ospedale   (t = minuti dalla mezzanotte della partenza da quella fermata,
//   nx = fermata successiva: serve per le linee circolari, che passano dalla stessa fermata alla stessa ora in due versi)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
const base = (n: string) => n.replace(/\s*"[^"]*"\s*$/, '').replace(/\s*\((fermata[^)]*|[A-Z]{1,2}|ex [^)]*)\)\s*$/i, '').replace(/\s+[A-Z]\d?$/, '').trim();
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const hav = (a: number, b: number, c: number, d: number) => Math.hypot((a - c) * 111000, (b - d) * 78000);
const hhmm = (m: number) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
let D: any = null, loadedAt = 0;
async function load() {
  if (D && Date.now() - loadedAt < 3600e3) return D;
  const url = Deno.env.get('SUPABASE_URL')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  let rows: any = null, err = '';
  for (let i = 0; i < 3 && !rows; i++) {
    try {
      const r = await fetch(`${url}/rest/v1/data_cache?key=in.(actv_gtfs,alilaguna_gtfs)&select=key,pack`, { headers: { apikey: srv, Authorization: 'Bearer ' + srv } });
      if (r.ok) rows = await r.json(); else err = 'db ' + r.status;
    } catch (e) { err = String(e); }
    if (!rows) await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  if (!rows) throw new Error(err || 'db');
  const stops: any[] = [], trips: any[] = [];
  for (const key of ['actv_gtfs', 'alilaguna_gtfs']) {
    const row = rows.find((r: any) => r.key === key); if (!row) continue;
    const q = row.pack, ali = key === 'alilaguna_gtfs', so = stops.length;
    q.stops.forEach((x: any[]) => stops.push(x));
    const names = q.routes.map((x: any[]) => { if (!ali) return String(x[1]); const nm = String(x[3] || x[1]).toLowerCase(); return 'Alilaguna ' + nm.charAt(0).toUpperCase() + nm.slice(1); });
    q.trips.forEach((t: any[]) => { const f = t[3].slice(); for (let k = 0; k < f.length; k += 3) f[k] += so; trips.push({ linea: names[t[0]], dir: q.heads[t[2]] || '', f }); });
  }
  D = { stops, trips }; loadedAt = Date.now(); return D;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const q = new URL(req.url).searchParams;
  const linea = q.get('linea') || '', dir = q.get('dir') || '', la = +(q.get('la') || 0), lo = +(q.get('lo') || 0), t = +(q.get('t') || NaN), tol = Math.min(600, +(q.get('tol') || 60)), nx = norm(q.get('nx') || '');
  if (!linea || !la || !lo || isNaN(t)) return json({ errore: 'parametri' }, 400);
  try {
    const d = await load();
    let best: any = null;
    for (const tr of d.trips) {
      if (tr.linea !== linea || (dir && tr.dir !== dir)) continue;
      const f = tr.f, n = f.length / 3;
      for (let k = 0; k < n; k++) {
        const dep = f[k * 3 + 2], diff = (((dep - t) % 1440) + 1440) % 1440;
        if (diff > 0.5 && diff < 1439.5) continue;
        const s = d.stops[f[k * 3]], dist = hav(la, lo, +s[2], +s[3]);
        if (dist > tol) continue;
        // con la fermata successiva si sceglie il verso giusto (es. 4.1 da F.te Nove verso Orto o verso il Cimitero)
        const okNx = !nx || (k + 1 < n && norm(base(String(d.stops[f[(k + 1) * 3]][1]))) === nx);
        const sc = dist + (okNx ? 0 : 100000);
        if (!best || sc < best.sc) best = { tr, k, dist, sc, off: t - dep };
      }
    }
    if (!best) return json({ errore: 'corsa_non_trovata' }, 404);
    const f = best.tr.f, n = f.length / 3, out: unknown[] = [];
    for (let k = best.k; k < n; k++) {
      const s = d.stops[f[k * 3]], ar = f[k * 3 + 1] + best.off, dp = f[k * 3 + 2] + best.off;
      // coordinate arrotondate come nelle posizioni dei battelli: così i tratti tra fermate hanno la stessa chiave
      out.push({ n: base(String(s[1])), lat: +(+s[2]).toFixed(5), lng: +(+s[3]).toFixed(5), arr: hhmm(ar), dep: Math.round(dp * 10) / 10, ar: Math.round(ar * 10) / 10 });
    }
    return json({ linea, dir: best.tr.dir, fermate: out });
  } catch (e) {
    return json({ errore: String(e) }, 500);
  }
});
