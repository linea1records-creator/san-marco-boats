// ClickVenice — vaporetti ACTV e Alilaguna: prossime partenze e viaggio migliore tra due pontili (orari ufficiali GTFS)
// ?azione=fermate                          → elenco dei pontili (nome, lat, lng)
// ?azione=partenze&pontile=Rialto&n=12     → prossime partenze
// ?azione=viaggio&da=Rialto&a=Lido S.M.E.  → percorso più veloce (con cambi) e, se c'è, quello senza cambi
// ?azione=posizioni                        → battelli in servizio adesso secondo l'orario (tratto in corso e i prossimi minuti)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' } });
let G: any = null, loadedAt = 0;
const base = (n: string) => n.replace(/\s*"[^"]*"\s*$/, '').replace(/\s*\((fermata[^)]*|[A-Z]{1,2}|ex [^)]*)\)\s*$/i, '').replace(/\s+[A-Z]\d?$/, '').trim();
const norm = (s: string) => (' ' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ') + ' ')
  .replace(/ (fondamente|fondamenta|f te|fte) /g, ' fte ').replace(/ (piazzale|p le|ple) /g, ' ple ').replace(/ (san|santa|santo|sant|ss|s) /g, ' s ')
  .replace(/ (stazione|santa lucia) /g, ' ferrovia ').replace(/\s+/g, ' ').trim();
const hav = (a: number, b: number, c: number, d: number) => Math.hypot((a - c) * 111000, (b - d) * 78000);
async function load() {
  if (G && Date.now() - loadedAt < 3600e3) return G;
  const url = Deno.env.get('SUPABASE_URL')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const rows = await (await fetch(`${url}/rest/v1/data_cache?key=in.(actv_gtfs,alilaguna_gtfs)&select=key,pack`, { headers: { apikey: srv, Authorization: 'Bearer ' + srv } })).json();
  const p: any = { stops: [], routes: [], heads: [], services: {}, trips: [] };
  for (const key of ['actv_gtfs', 'alilaguna_gtfs']) {
    const row = rows.find((r: any) => r.key === key); if (!row) continue;
    const q = row.pack, ali = key === 'alilaguna_gtfs', so = p.stops.length, ro = p.routes.length, ho = p.heads.length, sp = ali ? 'A:' : '';
    q.stops.forEach((x: any[]) => p.stops.push(x));
    q.routes.forEach((x: any[]) => { if (!ali) { p.routes.push([x[0], x[1], x[2], 'ACTV']); return; }
      const nm = String(x[3] || x[1]).toLowerCase(), nice = nm.charAt(0).toUpperCase() + nm.slice(1);
      p.routes.push([x[0], 'Alilaguna ' + nice, x[2] || (/aranc/.test(nm) ? 'F28C28' : /ross/.test(nm) ? 'D7263D' : /verd/.test(nm) ? '2E9E4F' : '1F5FBF'), 'Alilaguna']); });
    q.heads.forEach((h: string) => p.heads.push(h));
    Object.entries(q.services).forEach(([k, v]) => p.services[sp + k] = v);
    q.trips.forEach((t: any[]) => { const f = t[3].slice(); for (let k = 0; k < f.length; k += 3) f[k] += so; p.trips.push([t[0] + ro, sp + t[1], t[2] + ho, f]); });
  }
  const groups = new Map<string, any>(), stopGroup: number[] = [];
  p.stops.forEach((s: any[], i: number) => { const b = base(s[1]), kk = norm(b); if (!groups.has(kk)) groups.set(kk, { n: b, k: kk, st: [], lat: 0, lng: 0 }); const g = groups.get(kk); g.st.push(i); g.lat += s[2]; g.lng += s[3]; });
  const glist = [...groups.values()]; glist.forEach((g, gi) => { g.lat /= g.st.length; g.lng /= g.st.length; g.i = gi; g.st.forEach((s: number) => stopGroup[s] = gi); });
  const walk: number[][][] = glist.map(() => []);
  glist.forEach((a, i) => glist.forEach((b, j) => { if (i === j) return; const d = hav(a.lat, a.lng, b.lat, b.lng); if (d < 350) walk[i].push([j, Math.ceil(d / 80) + 1]); }));
  G = { p, glist, stopGroup, walk }; loadedAt = Date.now(); return G;
}
function romeNow() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const parts = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const ymd = parts.year + parts.month + parts.day, wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { ymd, wd, min: (+parts.hour % 24) * 60 + +parts.minute };
}
function prevDay(ymd: string, wd: number) { const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) - 864e5); return { ymd: d.toISOString().slice(0, 10).replace(/-/g, ''), wd: (wd + 6) % 7 }; }
function active(sv: any, ymd: string, wd: number) {
  if (!sv) return false; if (sv.meno.includes(ymd)) return false; if (sv.piu.includes(ymd)) return true;
  return sv.da && sv.da <= ymd && ymd <= sv.a && sv.g[wd] === 1;
}
// le corse dopo mezzanotte sono del servizio del giorno prima: se quel giorno è fuori dall'orario in vigore,
// uso lo stesso giorno della settimana dentro l'orario
function equivDay(g: any, ymd: string, wd: number, ali: boolean) {
  const sv = Object.entries(g.p.services).filter(([k]) => k.startsWith('A:') === ali).map(([, v]) => v) as any[];
  if (sv.some((x) => active(x, ymd, wd))) return { ymd, wd };
  const starts = sv.map((x) => x.da).filter(Boolean).sort(), first = starts[0]; if (!first) return { ymd, wd };
  let d = new Date(Date.UTC(+first.slice(0, 4), +first.slice(4, 6) - 1, +first.slice(6, 8)));
  for (let i = 0; i < 7; i++) { if ((d.getUTCDay() + 6) % 7 === wd) break; d = new Date(d.getTime() + 864e5); }
  return { ymd: d.toISOString().slice(0, 10).replace(/-/g, ''), wd };
}
function serviceDay(g: any, ali?: boolean) {
  const now = romeNow(), sv = Object.entries(g.p.services).filter(([k]) => ali === undefined || k.startsWith('A:') === ali).map(([, v]) => v) as any[];
  if (sv.some((x) => active(x, now.ymd, now.wd))) return { ...now, equivalente: null as string | null };
  const starts = sv.map((x) => x.da).filter(Boolean).sort(), first = starts[0];
  if (!first) return { ...now, equivalente: null };
  let d = new Date(Date.UTC(+first.slice(0, 4), +first.slice(4, 6) - 1, +first.slice(6, 8)));
  for (let i = 0; i < 7; i++) { const wd = (d.getUTCDay() + 6) % 7; if (wd === now.wd) break; d = new Date(d.getTime() + 864e5); }
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  return { ...now, ymd, equivalente: ymd };
}
function twoDays(g: any) { return [false, true].map((ali) => { const d = serviceDay(g, ali), p = prevDay(d.ymd, d.wd); return { d, y: equivDay(g, p.ymd, p.wd, ali) }; }); }
function connections(g: any, fromMin: number, toMin: number) {
  const days = twoDays(g);
  const now = days[0].d, out: number[][] = [];
  g.p.trips.forEach((t: any[], ti: number) => {
    const { d, y } = days[String(t[1]).startsWith('A:') ? 1 : 0];
    for (const [ymd, wd, off] of [[d.ymd, d.wd, 0], [y.ymd, y.wd, -1440]] as [string, number, number][]) {
      if (!active(g.p.services[t[1]], ymd, wd)) continue;
      const f = t[3];
      for (let k = 0; k + 3 < f.length; k += 3) {
        const dep = f[k + 2] + off, arr = f[k + 4] + off;
        if (dep < fromMin || dep > toMin) continue;
        out.push([dep, arr, f[k], f[k + 3], ti, off]);
      }
    }
  });
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { now, conns: out };
}
function findGroup(g: any, q: string) {
  if (!q) return null;
  if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(q)) { const [la, lo] = q.split(',').map(Number); let best = null, bd = 1e9; for (const x of g.glist) { const d = hav(la, lo, x.lat, x.lng); if (d < bd) { bd = d; best = x; } } return best; }
  const k = norm(q); return g.glist.find((x: any) => x.k === k) || g.glist.find((x: any) => x.k.startsWith(k)) || g.glist.find((x: any) => x.k.includes(k)) || null;
}
const hhmm = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
// pontili da cui partire / a cui arrivare: con un nome è quel pontile; con una posizione (lat,lng) tutti quelli raggiungibili a piedi
// entro maxM, ognuno con i minuti di cammino (linea d'aria × 1,3 a 80 m al minuto). Così da Cannaregio si va a piedi
// alle Fondamente Nove a prendere la linea diretta invece di salire al pontile più vicino e fare il giro.
function places(g: any, q: string, maxM: number) {
  if (!q) return [];
  if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(q)) {
    const [la, lo] = q.split(',').map(Number);
    const l = g.glist.map((x: any) => ({ x, d: hav(la, lo, x.lat, x.lng) })).sort((p: any, r: any) => p.d - r.d);
    const near = l.filter((o: any, k: number) => k === 0 || o.d <= maxM).slice(0, 14);
    return near.map((o: any) => ({ g: o.x, w: o.d < 40 ? 0 : Math.ceil(o.d * 1.3 / 80) }));
  }
  const x = findGroup(g, q); return x ? [{ g: x, w: 0 }] : [];
}
function csa(g: any, conns: number[][], from: any[], to: any[], t0: number, maxCorse: number) {
  const N = g.glist.length, best = new Array(N).fill(Infinity), inTrip = new Map<number, any>(), via: any[] = new Array(N).fill(null), rides = new Array(N).fill(99), wk = new Array(N).fill(0);
  const tw = new Map<number, number>(); to.forEach((t) => tw.set(t.g.i, t.w));
  const goal = () => { let m = Infinity; tw.forEach((w, i) => { if (best[i] + w < m) m = best[i] + w; }); return m; };
  for (const s of from) if (t0 + s.w < best[s.g.i]) { best[s.g.i] = t0 + s.w; rides[s.g.i] = 0; wk[s.g.i] = s.w; via[s.g.i] = s.w ? { walk: true, from: -1, dep: t0, arr: t0 + s.w } : null; }
  for (const s of from) for (const [j, w] of g.walk[s.g.i]) { const t = best[s.g.i] + w; if (t < best[j]) { best[j] = t; via[j] = { walk: true, from: s.g.i, dep: best[s.g.i], arr: t }; rides[j] = 0; wk[j] = wk[s.g.i] + w; } }
  let lim = goal();
  for (const c of conns) {
    const [dep, arr, s1, s2, ti] = c, g1 = g.stopGroup[s1], g2 = g.stopGroup[s2];
    if (dep > lim) break;
    const key = ti * 2 + (c[5] ? 1 : 0); let ride = inTrip.get(key);
    const ready = best[g1] + (via[g1] && !via[g1].walk ? 2 : 0), canBoard = ready <= dep && rides[g1] < maxCorse;
    if (!ride) {
      if (canBoard) { ride = { board: g1, dep, ti, n: rides[g1] + 1, wk: wk[g1] }; inTrip.set(key, ride); }
    } else if (canBoard && g1 !== ride.board && (rides[g1] + 1 < ride.n || (rides[g1] + 1 === ride.n && wk[g1] < ride.wk))) {
      // stessa corsa, ma ci si può salire a una fermata raggiunta con meno cambi o camminando meno: sali lì
      ride = { board: g1, dep, ti, n: rides[g1] + 1, wk: wk[g1] }; inTrip.set(key, ride);
    }
    if (ride && (arr < best[g2] || (arr === best[g2] && (ride.n < rides[g2] || (ride.n === rides[g2] && ride.wk < wk[g2]))))) {
      best[g2] = arr; rides[g2] = ride.n; wk[g2] = ride.wk; via[g2] = { ti: ride.ti, from: ride.board, dep: ride.dep, arr, off: c[5] };
      for (const [j, w] of g.walk[g2]) if (arr + w < best[j]) { best[j] = arr + w; via[j] = { walk: true, from: g2, dep: arr, arr: arr + w }; rides[j] = ride.n; wk[j] = ride.wk + w; }
      lim = goal();
    }
  }
  // arrivo: il pontile da cui si arriva prima a destinazione (contando il cammino finale); a pari tempo meno battelli e meno cammino
  let end = -1, endT = Infinity;
  tw.forEach((w, i) => { if (best[i] === Infinity || rides[i] === 0) return; const t = best[i] + w;
    if (t < endT || (t === endT && end >= 0 && (rides[i] < rides[end] || (rides[i] === rides[end] && wk[i] + w < wk[end] + tw.get(end)!)))) { endT = t; end = i; } });
  if (end < 0) return null;
  const legs: any[] = []; let cur = end, guard = 0;
  while (via[cur] && guard++ < 20) { const v = via[cur]; legs.unshift({ ...v, to: cur }); if (v.from < 0) break; cur = v.from; }
  const nm = (i: number) => i < 0 ? 'partenza' : g.glist[i].n;
  return { arrivo: best[end], fine: endT, fine_min: tw.get(end) || 0, da: nm(legs.find((l) => !l.walk)?.from ?? end), a: g.glist[end].n,
    legs: legs.map((l) => l.walk ? { tipo: 'piedi', da: nm(l.from), a: g.glist[l.to].n, min: l.arr - l.dep, parte: hhmm(l.dep) }
    : { tipo: 'linea', linea: g.p.routes[g.p.trips[l.ti][0]][1], colore: g.p.routes[g.p.trips[l.ti][0]][2], azienda: g.p.routes[g.p.trips[l.ti][0]][3], direzione: g.p.heads[g.p.trips[l.ti][2]], da: g.glist[l.from].n, a: g.glist[l.to].n, parte: hhmm(l.dep), arriva: hhmm(l.arr), min: l.arr - l.dep }) };
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const q = new URL(req.url).searchParams, az = q.get('azione') || 'partenze';
  try {
    const g = await load();
    if (az === 'fermate') return json({ pontili: g.glist.map((x: any) => [x.n, +x.lat.toFixed(6), +x.lng.toFixed(6)]), linee: g.p.routes.map((r: any[]) => [r[1], r[2], r[3]]) });
    const now = romeNow();
    if (az === 'posizioni') {
      const days = twoDays(g);
      const t = now.min, out: unknown[] = [];
      g.p.trips.forEach((tr: any[]) => {
        const { d, y } = days[String(tr[1]).startsWith('A:') ? 1 : 0], f = tr[3], n = f.length / 3;
        for (const [ymd, wd, off] of [[d.ymd, d.wd, 0], [y.ymd, y.wd, -1440]] as [string, number, number][]) {
          if (t < f[1] + off - 1 || t >= f[f.length - 2] + off) continue;
          if (!active(g.p.services[tr[1]], ymd, wd)) continue;
          let i0 = 0; for (let k = 0; k < n; k++) if (f[k * 3 + 2] + off <= t) i0 = k;
          let i1 = n - 1; for (let k = n - 1; k >= 0; k--) if (f[k * 3 + 1] + off >= t + 5) i1 = k;
          if (i1 <= i0) i1 = Math.min(n - 1, i0 + 1);
          const st: number[][] = [];
          for (let k = i0; k <= i1; k++) { const s = g.p.stops[f[k * 3]]; st.push([+(+s[2]).toFixed(5), +(+s[3]).toFixed(5), f[k * 3 + 1] + off, f[k * 3 + 2] + off]); }
          const r = g.p.routes[tr[0]];
          out.push([r[1], r[2], g.p.heads[tr[2]] || '', r[3], st, base(g.p.stops[f[(i0 + 1 < n ? i0 + 1 : i0) * 3]][1])]);
        }
      });
      return json({ adesso: now.min, battelli: out, orario_del: serviceDay(g, false).equivalente });
    }
    if (az === 'partenze') {
      const st = findGroup(g, q.get('pontile') || ''); if (!st) return json({ errore: 'pontile_non_trovato' }, 404);
      const n = Math.min(30, +(q.get('n') || 12));
      const { conns } = connections(g, now.min - 1, now.min + 240);
      const seen = new Set<string>(), out: unknown[] = [];
      for (const c of conns) {
        if (g.stopGroup[c[2]] !== st.i) continue;
        const t = g.p.trips[c[4]], k = c[4] + ':' + c[5]; if (seen.has(k)) continue; seen.add(k);
        out.push({ linea: g.p.routes[t[0]][1], colore: g.p.routes[t[0]][2], azienda: g.p.routes[t[0]][3], direzione: g.p.heads[t[2]], ora: hhmm(c[0]), tra_min: c[0] - now.min, banchina: (g.p.stops[c[2]][1].match(/"([^"]+)"\s*$/) || [])[1] || '' });
        if (out.length >= n) break;
      }
      return json({ pontile: st.n, adesso: hhmm(now.min), partenze: out, orario_del: serviceDay(g, false).equivalente });
    }
    if (az === 'viaggio') {
      const A = places(g, q.get('da') || '', 1000), B = places(g, q.get('a') || '', 700);
      if (!A.length || !B.length) return json({ errore: 'pontile_non_trovato', da: A[0]?.g.n, a: B[0]?.g.n }, 404);
      if (A.length === 1 && B.length === 1 && A[0].g.i === B[0].g.i) return json({ errore: 'stesso_pontile' }, 400);
      const t0 = now.min + Math.max(0, Math.min(180, +(q.get('fra') || 0)));
      const { conns } = connections(g, t0, t0 + 300);
      const veloce = csa(g, conns, A, B, t0, 5), diretto = csa(g, conns, A, B, t0, 1);
      if (!veloce && !diretto && A.some((x) => B.some((y) => y.g.i === x.g.i))) return json({ errore: 'stesso_pontile' }, 400);
      // senza cambi conviene se arriva al massimo 4 minuti dopo: il percorso con i cambi allora non serve
      const opz = (diretto && veloce && diretto.fine <= veloce.fine + 4 ? [diretto] : [veloce, diretto]).filter(Boolean)
        .map((o: any) => ({ arrivo: hhmm(o.arrivo), durata_min: o.arrivo - now.min, fine_min: o.fine_min, da: o.da, a: o.a, cambi: Math.max(0, o.legs.filter((l: any) => l.tipo === 'linea').length - 1), tappe: o.legs }));
      const o0: any = opz[0];
      return json({ da: o0 ? o0.da : A[0].g.n, a: o0 ? o0.a : B[0].g.n, fine_min: o0 ? o0.fine_min : 0, adesso: hhmm(now.min), opzioni: opz, orario_del: serviceDay(g, false).equivalente });
    }
    return json({ errore: 'azione_sconosciuta' }, 400);
  } catch (e) {
    return json({ errore: String(e) }, 500);
  }
});
