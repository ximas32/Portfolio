/* Verlaufs-Karten: Portfolio-Wert in CHF und Kursverlauf eines Wertpapiers.
   Die Ansichten zeichnen sich bei jeder Datenaenderung neu – darum gibt
   jede mount-Funktion eine Aufraeum-Funktion zurueck. */
import { getHistory, hasProxy } from './market.js';
import { valueSeries, priceSeries } from './calc.js';
import { lineChart, rangeChips, rangeStart, getRange, setRange } from './chart.js';
import { $, esc, fmtCur, fmtSigned, fmtPct, fmtNum } from './util.js';

function card(host, title, sub, status) {
  host.innerHTML = `
    <div class="card chart-card">
      <div class="chart-head">
        <h3>${esc(title)}</h3>
        ${rangeChips(getRange())}
      </div>
      ${sub ? `<p class="sub">${sub}</p>` : ''}
      <div class="chart-host"></div>
      ${status ? `<p class="sub">${status}</p>` : ''}
    </div>`;
  return $('.chart-host', host);
}

function bindRanges(host, remount) {
  $('.chart-ranges', host).addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    setRange(b.dataset.range);
    remount();
  });
}

function statusText(hist) {
  if (hist.loading) return '<span class="spinner"></span> Kursverlauf wird geladen …';
  if (hist.error) return `<span class="warn">Nicht alles geladen: ${esc(hist.error)}</span>`;
  if (!hasProxy) return 'Ohne Kurs-Proxy wird mit den Kaufkursen gerechnet.';
  return '';
}

/** Portfolio-Wert und Einstand in CHF (alle Konten oder ein Konto). */
export function mountValueChart(host, { accountId = null } = {}) {
  let off = () => {};
  const mount = () => {
    off();
    const hist = getHistory();
    const all = valueSeries(hist, accountId);
    if (all.length < 2) { host.innerHTML = ''; off = () => {}; return; }
    const from = rangeStart(getRange());
    const pts = from ? all.filter((p) => p.d >= from) : all;
    const chartHost = card(host, 'Verlauf in CHF', 'Wertschriften ohne Cash', statusText(hist));
    bindRanges(host, mount);
    off = lineChart(chartHost, {
      dates: pts.map((p) => p.d),
      series: [
        { label: 'Wert', color: 1, values: pts.map((p) => p.value), area: true },
        { label: 'Einstand', color: 2, values: pts.map((p) => p.cost) }
      ],
      format: (v) => fmtCur(v),
      note: (i) => {
        const p = pts[i];
        const gain = p.value - p.cost;
        return p.cost > 0 ? `Gewinn ${fmtSigned(gain)} (${fmtPct(gain / p.cost)})` : '';
      }
    });
  };
  mount();
  return () => off();
}

/** Kursverlauf eines Wertpapiers in seiner Waehrung, mit Kauf- und Verkaufspunkten. */
export function mountPriceChart(host, instrument, trades) {
  let off = () => {};
  const mount = () => {
    off();
    const hist = getHistory();
    const { currency, points: all } = priceSeries(hist, instrument);
    if (all.length < 2) {
      host.innerHTML = instrument?.symbol && hist.loading
        ? '<div class="card"><p class="sub"><span class="spinner"></span> Kursverlauf wird geladen …</p></div>'
        : '';
      off = () => {};
      return;
    }
    const from = rangeStart(getRange());
    const pts = from ? all.filter((p) => p.d >= from) : all;
    const chartHost = card(host, `Kurs in ${currency}`,
      '<i class="mkey buy"></i> Kauf &nbsp; <i class="mkey sell"></i> Verkauf',
      hist.error ? statusText(hist) : '');
    bindRanges(host, mount);

    // Jede Transaktion am ersten Handelstag ab ihrem Datum markieren
    const byIndex = new Map();
    for (const t of trades) {
      const i = pts.findIndex((p) => p.d >= t.date);
      if (i < 0) continue;
      (byIndex.get(i) || byIndex.set(i, []).get(i)).push(t);
    }
    off = lineChart(chartHost, {
      dates: pts.map((p) => p.d),
      series: [{ label: currency, color: 1, values: pts.map((p) => p.price), area: true }],
      markers: [...byIndex.entries()].map(([index, list]) => ({
        index, kind: list.some((t) => t.type === 'buy') ? 'buy' : 'sell'
      })),
      format: (v) => fmtCur(v, currency),
      note: (i) => (byIndex.get(i) || [])
        .map((t) => `${t.type === 'sell' ? 'Verkauf' : 'Kauf'} ${fmtNum(Number(t.quantity))} × ${fmtCur(Number(t.price), t.currency)}`)
        .join(' · ')
    });
  };
  mount();
  return () => off();
}
