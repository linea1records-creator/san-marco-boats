// Correzione (20/11/2026): le corse dopo mezzanotte appartengono al servizio del giorno prima.
// Se il giorno prima è fuori dal periodo dell'orario GTFS (es. l'orario nuovo parte oggi), uso lo stesso giorno della settimana dentro l'orario.
function equivDay(g: any, ymd: string, wd: number, ali: boolean) {
  const sv = Object.entries(g.p.services).filter(([k]) => k.startsWith('A:') === ali).map(([, v]) => v) as any[];
  if (sv.some((x) => active(x, ymd, wd))) return { ymd, wd };
  const starts = sv.map((x) => x.da).filter(Boolean).sort(), first = starts[0]; if (!first) return { ymd, wd };
  let d = new Date(Date.UTC(+first.slice(0, 4), +first.slice(4, 6) - 1, +first.slice(6, 8)));
  for (let i = 0; i < 7; i++) { if ((d.getUTCDay() + 6) % 7 === wd) break; d = new Date(d.getTime() + 864e5); }
  return { ymd: d.toISOString().slice(0, 10).replace(/-/g, ''), wd };
}
// in connections() e in azione=posizioni:  { d, y: equivDay(g, prevDay(d.ymd, d.wd).ymd, prevDay(d.ymd, d.wd).wd, ali) }
