// Общие элементы интерфейса: экранирование, значки, пометка «Реклама».
export const $ = (id) => document.getElementById(id);
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;

// Партнёрская ссылка в России — реклама. Пометка стоит у каждого партнёрского блока.
// Сведения о рекламодателе берутся из настроек (config.js → ads), а не из вёрстки; пустые поля не показываются.
const BRANDS = { aviasales: 'Aviasales', ostrovok: 'Островок', tripster: 'Трипстер' };
export function adMark(partner) {
  const info = window.AVIATOR?.ads?.[partner] ?? {};
  const details = [info.advertiser, info.inn ? `ИНН ${info.inn}` : '', info.erid ? `erid ${info.erid}` : ''].filter(Boolean).join(', ');
  return `<p class="ad-mark">Реклама · ${esc(BRANDS[partner] ?? partner)}${details ? ` · ${esc(details)}` : ''}</p>`;
}
