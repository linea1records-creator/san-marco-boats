// Aggiunta alla funzione "actv" (da inserire in Deno.serve, subito dopo `const now = romeNow();`)
// ?azione=posizioni → battelli in servizio adesso secondo l'orario: per ogni corsa le fermate
// dall'ultima lasciata alla prima che raggiungerà tra 5 minuti, come [lat, lng, arrivo, partenza] in minuti.
    if (az === 'posizioni') {
      const days = [false, true].map((ali) => { const d = serviceDay(g, ali); return { d, y: prevDay(d.ymd, d.wd) }; });
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
