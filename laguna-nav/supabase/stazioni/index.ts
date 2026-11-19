// ClickVenice — tabelloni di Ferrovia (treni, ViaggiaTreno) e Piazzale Roma (bus ACTV, orari GTFS)
// ?tipo=treni&verso=partenze|arrivi   → prossimi treni a Venezia Santa Lucia, con ritardi e binari
// ?tipo=bus&luogo=proma|lido&verso=partenze|arrivi → prossimi bus ACTV a Piazzale Roma o al Lido S.M.E.
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
  const a = await r.json(), arr = verso === 'arrivi', now = romeNow().min;
  const gone = (t: any) => { const o = arr ? t.compOrarioArrivo : t.compOrarioPartenza; if (!/^\d\d:\d\d$/.test(o || '')) return false;
    let m = +o.slice(0, 2) * 60 + +o.slice(3) + (typeof t.ritardo === 'number' ? t.ritardo : 0); if (m - now > 720) m -= 1440; if (now - m > 720) m += 1440; return m < now - 2; };
  return (a || []).filter((t: any) => !gone(t)).slice(0, 25).map((t: any) => {
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

/* ---------- bus ACTV ai capolinea (Piazzale Roma, Lido S.M.E.): orari GTFS, solo le corse che passano di lì ---------- */
const BUS: Record<string, any> = {};
// capolinea dei bus: centro, raggio, nomi delle fermate e come si riconosce una corsa diretta lì
const LUOGHI: Record<string, any> = {
  proma: { nome: 'Piazzale Roma', lat: 45.4379, lng: 12.3175, r: 300, re: /piazzale\s*roma|p\.?\s*le\s*roma/i, verso: /roma|venezia/i },
  lido: { nome: 'Lido S.M.E.', lat: 45.4181, lng: 12.3696, r: 220, re: /elisabetta|s\.?\s*m\.?\s*e\.?$|lido\s+s\.?\s*m\.?\s*e/i, verso: /elisabetta|s\.?\s*m\.?\s*e|^lido$/i },
};
const mins = (t: string) => { const [h, m] = t.trim().split(':').map(Number); return h * 60 + m; };
// zip letto a pezzi con richieste "Range": indice in fondo, poi solo i file che servono, decompressi in streaming
async function getRange(a: number, b: number) {
  const r = await fetch(BUS_SRC, { headers: { 'User-Agent': UA, Range: `bytes=${a}-${b}` } });
  if (r.status !== 206) throw new Error('il server degli orari non accetta download a pezzi (' + r.status + ')');
  return r;
}
async function loadZip() {
  const t = await getRange(0, 0); await t.arrayBuffer();
  const total = +((t.headers.get('content-range') || '').split('/')[1] || 0); if (!total) throw new Error('dimensione zip sconosciuta');
  const tailStart = Math.max(0, total - 131072), tail = new Uint8Array(await (await getRange(tailStart, total - 1)).arrayBuffer()), dv = new DataView(tail.buffer);
  let e = tail.length - 22; while (e > 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true) - tailStart; const files: Record<string, any> = {};
  for (let i = 0; i < n && p >= 0 && p < tail.length; i++) {
    const meth = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(tail.subarray(p + 46, p + 46 + nl)).split('/').pop() || '';
    files[name] = { meth, csize, off, nl }; p += 46 + nl + xl + cl;
  }
  return files;
}
function textStream(f: any): ReadableStream<string> {
  let started = false, skip = 0, left = f.csize, hdr = new Uint8Array(0);
  const cut = new TransformStream<Uint8Array, Uint8Array>({ transform(ch, ctl) {
    if (!started){ const h = new Uint8Array(hdr.length + ch.length); h.set(hdr); h.set(ch, hdr.length); if (h.length < 30){ hdr = h; return; }
      const v = new DataView(h.buffer); skip = 30 + v.getUint16(26, true) + v.getUint16(28, true); started = true; ch = h; }
    if (skip){ if (ch.length <= skip){ skip -= ch.length; return; } ch = ch.subarray(skip); skip = 0; }
    if (left <= 0) return; if (ch.length > left) ch = ch.subarray(0, left); left -= ch.length; ctl.enqueue(ch); } });
  const body = new ReadableStream<Uint8Array>({ async start(ctl) {
    const r = await getRange(f.off, f.off + 30 + f.nl + 1024 + f.csize); const rd = r.body!.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; ctl.enqueue(value); } ctl.close(); } });
  const raw = body.pipeThrough(cut);
  return (f.meth === 8 ? raw.pipeThrough(new DecompressionStream('deflate-raw') as any) : raw).pipeThrough(new TextDecoderStream() as any) as any;
}
async function readText(f: any) { if (!f) return ''; let out = ''; const rd = textStream(f).getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; out += value; } return out; }
function rows(txt: string) {   // csv semplice (i file GTFS di ACTV non hanno virgole tra virgolette)
  const L = txt.replace(/^\uFEFF/, '').split('\n'), head = (L[0] || '').trim().split(',').map((h) => h.trim().replace(/"/g, ''));
  return { head, col: (c: string) => head.indexOf(c), rows: L.slice(1).filter((l) => l.trim()).map((l) => l.replace('\r', '').split(',').map((x) => x.trim().replace(/^"|"$/g, ''))) };
}
// legge un file riga per riga senza tenerlo tutto in memoria
async function eachLine(f: any, cb: (cells: string[], head: string[]) => void) {
  if (!f) return; let head: string[] | null = null, rest = ''; const rd = textStream(f).getReader();
  const doLine = (l: string) => { l = l.replace('\r', ''); if (!l.trim()) return; const c = l.split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
    if (!head){ head = c.map((x) => x.replace(/^\uFEFF/, '')); return; } cb(c, head); };
  for (;;) { const { done, value } = await rd.read(); const s2 = rest + (value || ''); const L = s2.split('\n'); rest = done ? '' : L.pop() || ''; L.forEach(doLine); if (done){ if (rest) doLine(rest); break; } }
}
async function buildBus(k: string) {
  const L = LUOGHI[k];
  const url = Deno.env.get('SUPABASE_URL')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const H = { apikey: srv, Authorization: 'Bearer ' + srv };
  const cached = await (await fetch(`${url}/rest/v1/data_cache?key=eq.bus_${k}&select=pack`, { headers: H })).json();
  if (cached && cached[0] && cached[0].pack && cached[0].pack.v === 3 && Date.now() - cached[0].pack.t < 7 * 864e5) return cached[0].pack;
  const Z = await loadZip();
  const S = rows(await readText(Z['stops.txt']));
  // fermate del capolinea: quelle vicine al centro (i nomi ACTV non dicono sempre il nome del piazzale)
  const near = (x: string[]) => Math.hypot((+x[S.col('stop_lat')] - L.lat) * 111000, (+x[S.col('stop_lon')] - L.lng) * 78000) < L.r;
  const pr = S.rows.filter((x) => near(x) || (L.re.test(x[S.col('stop_name')] || '') && Math.hypot((+x[S.col('stop_lat')] - L.lat) * 111000, (+x[S.col('stop_lon')] - L.lng) * 78000) < 1500)).map((x) => x[S.col('stop_id')]);
  if (!pr.length) throw new Error('fermate di ' + L.nome + ' non trovate');
  const R = rows(await readText(Z['routes.txt'])), routes: Record<string, string[]> = {};
  R.rows.forEach((x) => { routes[x[R.col('route_id')]] = [x[R.col('route_short_name')] || '', R.col('route_color') >= 0 ? x[R.col('route_color')] || '' : '', R.col('route_long_name') >= 0 ? x[R.col('route_long_name')] || '' : '']; });
  const services: Record<string, any> = {};
  const C = rows(await readText(Z['calendar.txt']));
  if (C.rows.length) { const d = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((x) => C.col(x));
    C.rows.forEach((x) => { services[x[C.col('service_id')]] = { g: d.map((i) => x[i] === '1' ? 1 : 0), da: x[C.col('start_date')], a: x[C.col('end_date')], piu: [], meno: [] }; }); }
  const CD = rows(await readText(Z['calendar_dates.txt']));
  CD.rows.forEach((x) => { const id = x[CD.col('service_id')], s = services[id] || (services[id] = { g: [0, 0, 0, 0, 0, 0, 0], da: '', a: '', piu: [], meno: [] }); (x[CD.col('exception_type')] === '1' ? s.piu : s.meno).push(x[CD.col('date')]); });
  // stop_times: cerco solo le righe con le fermate di Piazzale Roma (indexOf, velocissimo)
  const ev: any[] = []; let head: string[] | null = null, rest = '', iT = 0, iA = 0, iD = 0, iS = 0;
  // una sola passata con un'unica espressione per tutte le fermate del terminal
  const reS = new RegExp(',"?(?:' + pr.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')"?,', 'g');
  const scan = (blk: string) => { reS.lastIndex = 0; let m: RegExpExecArray | null;
    while ((m = reS.exec(blk))) { const i = m.index; const a0 = blk.lastIndexOf('\n', i) + 1; let b0 = blk.indexOf('\n', i); if (b0 < 0) b0 = blk.length;
      const f = blk.slice(a0, b0).replace('\r', '').split(',').map((x) => x.replace(/"/g, '').trim());
      if (pr.includes(f[iS])) { const a = f[iA] || f[iD], d = f[iD] || f[iA]; if (a) ev.push([f[iT], mins(a), mins(d)]); }
      reS.lastIndex = b0; } };
  const rd = textStream(Z['stop_times.txt']).getReader();
  for (;;) { const { done, value } = await rd.read(); let s2 = rest + (value || '');
    if (!head){ const nl = s2.indexOf('\n'); if (nl < 0 && !done){ rest = s2; continue; }
      head = s2.slice(0, nl).replace(/^\uFEFF/, '').trim().split(',').map((h) => h.trim().replace(/"/g, ''));
      iT = head.indexOf('trip_id'); iA = head.indexOf('arrival_time'); iD = head.indexOf('departure_time'); iS = head.indexOf('stop_id'); s2 = '\n' + s2.slice(nl + 1); }
    if (done){ scan(s2); break; }
    const cut = s2.lastIndexOf('\n'); if (cut <= 0){ rest = s2; continue; } scan(s2.slice(0, cut)); rest = s2.slice(cut); }
  // corse: tengo solo quelle che passano da Piazzale Roma
  const want = new Set(ev.map((x) => x[0])), trips: Record<string, any> = {};
  let ti = -1, tr = -1, ts = -1, th = -1;
  await eachLine(Z['trips.txt'], (c, h) => { if (ti < 0){ ti = h.indexOf('trip_id'); tr = h.indexOf('route_id'); ts = h.indexOf('service_id'); th = h.indexOf('trip_headsign'); }
    if (want.has(c[ti])) trips[c[ti]] = { r: c[tr], s: c[ts], h: th >= 0 ? c[th] : '' }; });
  // la corsa arriva al capolinea se è diretta lì (ultima parte della destinazione)
  const toPR = (h: string) => L.verso.test(((h || '').split(/\s+-\s+/).pop() || '').trim());
  const out = ev.filter((x) => trips[x[0]]).map(([tid, a, d]) => { const t = trips[tid], ro = routes[t.r] || ['', '', ''], arr = toPR(t.h);
    return [ro[0], ro[1], arr ? (ro[2] || t.h || '') : (t.h || ro[2] || ''), t.s, arr ? a : d, arr ? 'a' : 'p']; });
  const pack = { v: 3, t: Date.now(), services, ev: out, fermate: pr.length };
  await fetch(`${url}/rest/v1/data_cache`, { method: 'POST', headers: { ...H, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: 'bus_' + k, pack, updated_at: new Date().toISOString() }) });
  return pack;
}
function active(sv: any, ymd: string, wd: number) { if (!sv) return false; if (sv.meno.includes(ymd)) return false; if (sv.piu.includes(ymd)) return true; return sv.da && sv.da <= ymd && ymd <= sv.a && sv.g[wd] === 1; }
function prevDay(ymd: string, wd: number) { const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) - 864e5); return { ymd: d.toISOString().slice(0, 10).replace(/-/g, ''), wd: (wd + 6) % 7 }; }
async function bus(k: string, verso: string) {
  if (!BUS[k] || Date.now() - BUS[k].loaded > 3600e3) { BUS[k] = await buildBus(k); BUS[k].loaded = Date.now(); }
  const B = BUS[k];
  const now = romeNow(), y = prevDay(now.ymd, now.wd), kk = verso === 'arrivi' ? 'a' : 'p', out: any[] = [];
  for (const e of B.ev) {
    if (e[5] !== kk) continue;
    for (const [ymd, wd, off] of [[now.ymd, now.wd, 0], [y.ymd, y.wd, -1440]] as [string, number, number][]) {
      if (!active(B.services[e[3]], ymd, wd)) continue;
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
    if (tipo === 'cerca'){ const L = LUOGHI[q.get('luogo') || 'proma'] || LUOGHI.proma; const Z = await loadZip(); const S = rows(await readText(Z['stops.txt'])); const k = (q.get('q') || 'roma').toLowerCase();
      return json({ file: Object.keys(Z), fermate: S.rows.filter((x) => (x[S.col('stop_name')] || '').toLowerCase().includes(k) || Math.hypot((+x[S.col('stop_lat')] - L.lat) * 111000, (+x[S.col('stop_lon')] - L.lng) * 78000) < 600).map((x) => [x[S.col('stop_id')], x[S.col('stop_name')], x[S.col('stop_lat')], x[S.col('stop_lon')]]).slice(0, 80) }); }
    if (tipo === 'bus'){ const k = LUOGHI[q.get('luogo') || ''] ? q.get('luogo')! : 'proma';
      return json({ stazione: LUOGHI[k].nome, verso, adesso: hhmm(romeNow().min), corse: await bus(k, verso), fermate: BUS[k] ? BUS[k].fermate : 0 }); }
    return json({ errore: 'tipo_sconosciuto' }, 400);
  } catch (e) {
    return json({ errore: String(e) }, 502);
  }
});
