// ClickVenice — tabelloni di Ferrovia (treni, ViaggiaTreno) e Piazzale Roma (bus ACTV, orari GTFS)
// ?tipo=treni&verso=partenze|arrivi   → prossimi treni a Venezia Santa Lucia, con ritardi e binari
// ?tipo=bus&verso=partenze|arrivi     → prossimi bus ACTV a Piazzale Roma
import { unzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8.2';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' } });
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const BUS_SRC = 'https://actv.avmspa.it/sites/default/files/attachments/opendata/automobilistico/actv_aut.zip';
const STAZIONE = 'S02593';   // Venezia Santa Lucia

function romeParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short', timeZoneName: 'shortOffset' });
  return Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
}
function romeNow() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const parts = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { ymd: parts.year + parts.month + parts.day, wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday), min: (+parts.hour % 24) * 60 + +parts.minute };
}
const hhmm = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };

/* ---------- treni ---------- */
async function treni(verso: string) {
  const p = romeParts();
  const off = (p.timeZoneName || 'GMT+1').replace('GMT', '').replace(':', '');
  const sign = off.startsWith('-') ? '-' : '+', hh = off.replace(/^[+-]/, '').padStart(2, '0');
  const ds = `${p.weekday} ${p.month} ${p.day} ${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second} GMT${sign}${hh.length <= 2 ? hh + '00' : hh}`;
  const url = `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/${verso === 'arrivi' ? 'arrivi' : 'partenze'}/${STAZIONE}/${encodeURIComponent(ds)}`;
  let r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) r = await fetch(url.replace('http:', 'https:'), { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('viaggiatreno ' + r.status);
  const a = await r.json(), arr = verso === 'arrivi';
  return (a || []).slice(0, 25).map((t: any) => {
    const prog = arr ? t.binarioProgrammatoArrivoDescrizione : t.binarioProgrammatoPartenzaDescrizione, eff = arr ? t.binarioEffettivoArrivoDescrizione : t.binarioEffettivoPartenzaDescrizione;
    return {
      ora: arr ? t.compOrarioArrivo : t.compOrarioPartenza,
      treno: String(t.compNumeroTreno || ((t.categoriaDescrizione || t.categoria || '') + ' ' + t.numeroTreno)).replace(/\s+/g, ' ').trim(),
      luogo: arr ? t.origine : t.destinazione,
      ritardo: typeof t.ritardo === 'number' ? t.ritardo : 0,
      binario: String(eff || prog || '').trim(),
      cambio_binario: !!(eff && prog && String(eff).trim() !== String(prog).trim()),
      soppresso: t.provvedimento === 1,
      in_stazione: !!t.inStazione,
    };
  });
}

/* ---------- bus ACTV a Piazzale Roma (GTFS, solo le corse che toccano Piazzale Roma) ---------- */
let BUS: any = null;
function csv(txt: string) {
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const split = (l: string) => { const out: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const head = split(lines[0] || ''); return { head, rows: lines.slice(1).map(split), col: (n: string) => head.indexOf(n) };
}
const mins = (t: string) => { const [h, m] = t.trim().split(':').map(Number); return h * 60 + m; };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function buildBus() {
  const url = Deno.env.get('SUPABASE_URL')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const H = { apikey: srv, Authorization: 'Bearer ' + srv };
  const cached = await (await fetch(`${url}/rest/v1/data_cache?key=eq.bus_proma&select=pack`, { headers: H })).json();
  if (cached && cached[0] && cached[0].pack && Date.now() - cached[0].pack.t < 7 * 864e5) return cached[0].pack;
  let r = await fetch(BUS_SRC, { headers: { 'User-Agent': UA } });
  if (!r.ok) r = await fetch(BUS_SRC.replace('https:', 'http:'), { headers: { 'User-Agent': UA } });
  if (!r.ok) { if (cached && cached[0]) return cached[0].pack; throw new Error('download bus ' + r.status); }
  const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const get = (n: string) => { const k = Object.keys(files).find((f) => f.endsWith(n)); return k ? strFromU8(files[k]) : ''; };
  const S = csv(get('stops.txt'));
  const pr = new Set(S.rows.filter((x) => /piazzale\s*roma|p\.?\s*le\s*roma/i.test(x[S.col('stop_name')])).map((x) => x[S.col('stop_id')]));
  const R = csv(get('routes.txt')), routes: Record<string, string[]> = {};
  R.rows.forEach((x) => { routes[x[R.col('route_id')]] = [x[R.col('route_short_name')] || '', R.col('route_color') >= 0 ? x[R.col('route_color')] || '' : '', R.col('route_long_name') >= 0 ? x[R.col('route_long_name')] || '' : '']; });
  const services: Record<string, any> = {};
  const C = csv(get('calendar.txt'));
  if (C.rows.length) { const d = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((x) => C.col(x));
    C.rows.forEach((x) => { services[x[C.col('service_id')]] = { g: d.map((i) => x[i] === '1' ? 1 : 0), da: x[C.col('start_date')], a: x[C.col('end_date')], piu: [], meno: [] }; }); }
  const CD = csv(get('calendar_dates.txt'));
  CD.rows.forEach((x) => { const id = x[CD.col('service_id')], s = services[id] || (services[id] = { g: [0, 0, 0, 0, 0, 0, 0], da: '', a: '', piu: [], meno: [] }); (x[CD.col('exception_type')] === '1' ? s.piu : s.meno).push(x[CD.col('date')]); });
  const T = csv(get('trips.txt')), trips: Record<string, any> = {};
  T.rows.forEach((x) => { trips[x[T.col('trip_id')]] = { r: x[T.col('route_id')], s: x[T.col('service_id')], h: T.col('trip_headsign') >= 0 ? x[T.col('trip_headsign')] : '' }; });
  // stop_times: tengo solo le righe di Piazzale Roma (una regex sola sul file intero)
  const st = get('stop_times.txt'), nl = st.indexOf('\n'), head = st.slice(0, nl).replace(/^﻿/, '').trim().split(',').map((h) => h.trim().replace(/"/g, ''));
  const iT = head.indexOf('trip_id'), iA = head.indexOf('arrival_time'), iD = head.indexOf('departure_time'), iS = head.indexOf('stop_id'), iQ = head.indexOf('stop_sequence');
  const ids = [...pr].map(esc).join('|'); const ev: any[] = [];
  if (ids) {
    const cols = head.map((_, i) => i === iS ? `"?(?:${ids})"?` : '([^,\\r\\n]*)');
    const re = new RegExp('^' + cols.join(',') + '(?:,[^\\r\\n]*)?\\r?$', 'gm');
    let m: RegExpExecArray | null; const idx = (i: number) => i - (i > iS ? 1 : 0) + 1;
    while ((m = re.exec(st))) {
      const g = (i: number) => (m![idx(i)] || '').replace(/"/g, '').trim();
      const t = trips[g(iT)]; if (!t) continue;
      const a = g(iA) || g(iD), d = g(iD) || g(iA); if (!a) continue;
      ev.push([g(iT), +g(iQ), mins(a), mins(d)]);
    }
  }
  // ultima fermata di ogni corsa che passa da Piazzale Roma: capisco se a Piazzale Roma arriva (capolinea) o parte
  const want = new Set(ev.map((e) => e[0])), last: Record<string, number> = {};
  if (want.size) {
    let pos = nl + 1;
    while (pos < st.length) { let end = st.indexOf('\n', pos); if (end < 0) end = st.length; const line = st.slice(pos, end); pos = end + 1;
      const f = line.split(','); const tid = (f[iT] || '').replace(/"/g, '').trim(); if (!want.has(tid)) continue;
      const q = +(f[iQ] || '').replace(/"/g, ''); if (!(tid in last) || q > last[tid]) last[tid] = q; }
  }
  const out = ev.map(([tid, q, a, d]) => { const t = trips[tid], ro = routes[t.r] || ['', '', ''], fine = last[tid] === q;
    return [ro[0], ro[1], fine ? (ro[2] || '') : (t.h || ro[2] || ''), t.s, fine ? a : d, fine ? 'a' : 'p']; });
  const pack = { t: Date.now(), services, ev: out, fermate: pr.size };
  await fetch(`${url}/rest/v1/data_cache`, { method: 'POST', headers: { ...H, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: 'bus_proma', pack, updated_at: new Date().toISOString() }) });
  return pack;
}
function active(sv: any, ymd: string, wd: number) { if (!sv) return false; if (sv.meno.includes(ymd)) return false; if (sv.piu.includes(ymd)) return true; return sv.da && sv.da <= ymd && ymd <= sv.a && sv.g[wd] === 1; }
function prevDay(ymd: string, wd: number) { const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) - 864e5); return { ymd: d.toISOString().slice(0, 10).replace(/-/g, ''), wd: (wd + 6) % 7 }; }
async function bus(verso: string) {
  if (!BUS || Date.now() - BUS.loaded > 3600e3) { BUS = await buildBus(); BUS.loaded = Date.now(); }
  const now = romeNow(), y = prevDay(now.ymd, now.wd), k = verso === 'arrivi' ? 'a' : 'p', out: any[] = [];
  for (const e of BUS.ev) {
    if (e[5] !== k) continue;
    for (const [ymd, wd, off] of [[now.ymd, now.wd, 0], [y.ymd, y.wd, -1440]] as [string, number, number][]) {
      if (!active(BUS.services[e[3]], ymd, wd)) continue;
      const t = e[4] + off; if (t < now.min - 1 || t > now.min + 180) continue;
      out.push({ ora: hhmm(t), tra_min: t - now.min, linea: e[0], colore: e[1], luogo: e[2] });
    }
  }
  out.sort((a, b) => a.tra_min - b.tra_min);
  const seen = new Set<string>();
  return out.filter((x) => { const kk = x.ora + x.linea + x.luogo; if (seen.has(kk)) return false; seen.add(kk); return true; }).slice(0, 25);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const q = new URL(req.url).searchParams, tipo = q.get('tipo') || 'treni', verso = q.get('verso') === 'arrivi' ? 'arrivi' : 'partenze';
  try {
    if (tipo === 'treni') return json({ stazione: 'Venezia Santa Lucia', verso, adesso: hhmm(romeNow().min), corse: await treni(verso) });
    if (tipo === 'bus') return json({ stazione: 'Piazzale Roma', verso, adesso: hhmm(romeNow().min), corse: await bus(verso), fermate: BUS ? BUS.fermate : 0 });
    return json({ errore: 'tipo_sconosciuto' }, 400);
  } catch (e) {
    return json({ errore: String(e) }, 502);
  }
});
