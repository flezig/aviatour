import './site.js';
import { tripScores } from './lib/season-scores.js';
import { fmtMoney, fmtDay, localZone } from './lib/format.js';
import { storedOrigin } from './lib/origin.js';

const panel = document.getElementById('season');
const { code, month } = panel.dataset;
const get = async path => {
  const response = await fetch(path);
  if (!response.ok) throw Error();
  return response.json();
};
const fareNote = document.getElementById('seasonFareNote');

async function fares() {
  let from = panel.dataset.origin, fc = panel.dataset.all;
  if (!new URLSearchParams(location.search).has('from')) {
    const saved = storedOrigin();
    if (saved && saved.code !== code) {
      from = saved.iata;
      fc = saved.all ? saved.code : '';
      // Preserve the selected origin when switching months.
      for (const a of panel.querySelectorAll('a')) {
        const url = new URL(a.href);
        url.searchParams.set('from',from);
        if (fc) url.searchParams.set('fc',fc); else url.searchParams.delete('fc');
        a.href=url.href;
      }
    }
  }
  const query = new URLSearchParams({from});
  if (fc) query.set('fc',fc);
  try {
    const result = await get('/api/v1/season/'+code+'/fares?'+query);
    const offers = Object.entries(result.month_fares || {});
    const found = offers.find(([m]) => Number(m.slice(5)) === Number(month));
    if (!found) {
      fareNote.textContent = 'На выбранный месяц цены из '+result.origin.from+' пока нет. Ищем поездки на ближайшие шесть месяцев.';
      return offers;
    }
    const [key, offer] = found;
    document.getElementById('seasonPrice').textContent = 'от '+fmtMoney(offer.minor);
    const ordered = offers.map(([,item]) => item.minor).sort((a,b)=>a-b);
    let comparison = '';
    if (ordered.length >= 3) {
      const middle = Math.floor(ordered.length/2);
      const median = ordered.length%2 ? ordered[middle] : (ordered[middle-1]+ordered[middle])/2;
      const diff = Math.round(100*(offer.minor/median-1));
      comparison = diff ? ' На '+Math.abs(diff)+'% '+(diff<0?'ниже':'выше')+' медианы месячных минимумов по этому маршруту ('+offers.length+' мес.).' : ' Совпадает с медианой месячных минимумов по этому маршруту ('+offers.length+' мес.).';
    }
    fareNote.textContent = 'Из '+result.origin.from+', '+key.slice(0,4)+' год. На одного, 1–7 ночей.'+comparison;
    const a = document.createElement('a');
    a.href=offer.url;
    a.textContent='Посмотреть билеты';
    document.getElementById('seasonFareLink').append('Aviasales · '+fmtDay(new Date(offer.received),localZone)+' · ',a);
    return offers;
  } catch {
    fareNote.textContent='Не удалось загрузить цены на перелёт. Обновите страницу, чтобы проверить ещё раз.';
  }
}
async function advice() {
  if (panel.dataset.fcdo !== '1') return panel.dataset.domestic === '1' ? 'domestic' : 'unknown';
  try {
    const result = await get('/api/v1/season/'+code+'/advice');
    const p = document.getElementById('seasonSafety');
    if (result.status !== 'warning') return result.status === 'published' ? 'published' : 'unknown';
    const whole = result.alerts.some(s => s.includes('whole_country'));
    p.textContent = whole ? 'У британского МИД есть предупреждение о поездках в страну.' : 'У британского МИД есть предупреждение по направлению. Проверьте, касается ли оно вашего маршрута.';
    const a = document.createElement('a');
    a.href=result.source_url;
    a.textContent='Предупреждение FCDO для британских граждан';
    p.parentElement.querySelector('small').append(' · ',a);
    p.parentElement.classList.add('season-warning');
    return whole || result.alerts.some(a => !a.includes('parts')) ? 'whole' : 'regional';
  } catch { /* The Russian source is always available in the original page. */ }
}
const [offers, safety] = await Promise.all([fares(),advice()]);
if (panel.dataset.mode === 'trip') {
  const scores = tripScores(JSON.parse(panel.dataset.walk), JSON.parse(panel.dataset.counts), offers || []);
  const verdict = document.getElementById('seasonVerdict');
  const value = document.getElementById('seasonValue');
  const blocked = !safety || safety === 'unknown' || safety === 'whole';
  if (blocked) {
    verdict.textContent = safety === 'whole' ? 'Есть предупреждение о поездках. Проверьте рекомендации ниже.' : 'Для общей оценки не удалось проверить предупреждения по стране.';
  } else {
    for (const [i,a] of [...panel.querySelectorAll('.season-months a')].entries()) {
      const result = scores.get(i+1);
      const b = document.createElement('b');
      b.textContent = result == null ? '—' : String(result);
      a.append(b);
      a.setAttribute('aria-label', a.textContent.slice(0,3) + (result == null ? ', мало данных' : ', '+result+' из 10'));
    }
    const selected = scores.get(Number(month));
    if (selected == null) {
      verdict.textContent = 'Мало цен для сравнения в этом месяце.';
    } else {
      value.textContent = selected;
      const small = document.createElement('small'); small.textContent='/10'; value.append(small);
      verdict.textContent = safety === 'regional' ? 'Есть региональное предупреждение. Проверьте маршрут.' : 'Благоприятность месяца с учётом цены перелёта.';
    }
  }
}
