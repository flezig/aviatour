// One small score index is shared by all cards. The complete city report works without it.
const labels = 'янв фев мар апр май июн июл авг сен окт ноя дек'.split(' ');
let scores = {}, loading;
function label(code, month) {
  const value = scores[code]?.[month-1];
  return (value == null ? 'Сезон' : 'Прогулки '+parseInt(value, 16)+'/10')+' · '+labels[month-1];
}
export function seasonLink(code, month, from) {
  if (!/^[A-ZА-ЯЁ0-9]{3}$/u.test(code) || !Number.isInteger(month) || month<1 || month>12) return '';
  const query = new URLSearchParams({month});
  if (/^[A-Z]{3}$/.test(from)) query.set('from',from);
  return `<a class="season-link" data-season-city="${code}" data-season-month="${month}" href="/season/${encodeURIComponent(code)}?${query.toString().replaceAll('&','&amp;')}">${label(code,month)}</a>`;
}
export function loadSeasonScores() {
  loading ??= fetch('/api/v1/season-scores').then(r => r.ok ? r.json() : {}).then(data => {
    scores = data;
    for (const a of document.querySelectorAll('[data-season-city]')) {
      a.textContent = label(a.dataset.seasonCity,Number(a.dataset.seasonMonth));
    }
  }).catch(() => {});
  return loading;
}
