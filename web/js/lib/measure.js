// Яндекс Метрика и уведомление о cookie. Пока в config.js нет номера счётчика, не загружается ничего и уведомления нет.
// С номером счётчика Метрика загружается только после согласия посетителя; выбор хранится в этом браузере.
//
// Цели (в Метрике — «JavaScript-событие» с тем же идентификатором) и их параметры:
//   search          — посетитель сам запустил поиск: from, region
//   select_idea     — выбрал подборку, фильтр или подсказку: idea (filter-direct, longer, shifted, similar …)
//   view_city       — открыл поездку в город: city, from, page
//   save_trip       — сохранил поездку в избранное: city, nights, people
//   affiliate_click — перешёл к партнёру: partner, block, city
//   share           — поделился поездкой
// Прежние цели: trip → view_city, aviasales и hotel → affiliate_click, longer / shifted / similar → select_idea,
// favorite → save_trip; search и share остались.
const config = window.AVIATOR ?? {};
const id = /^\d{5,12}$/.test(String(config.metrika ?? '')) ? Number(config.metrika) : 0;
const KEY = 'aviator.consent';
let loaded = false;

export const metrikaOn = Boolean(id);
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const store = (value) => { try { localStorage.setItem(KEY, value); } catch { /* частный режим: выбор живёт до конца визита */ } };

function load() {
  if (loaded || !id) return;
  loaded = true;
  // Официальная заглушка загрузчика: вызовы до прихода tag.js копятся и выполняются им.
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = Date.now();
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.append(script);
  window.ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
}

export function goal(name, params = {}) {
  if (loaded) window.ym(id, 'reachGoal', name, params);
}

// Уведомление стоит в начале страницы, в потоке текста, а не поверх содержимого. Одно на браузер.
function notice() {
  const main = document.querySelector('main');
  if (!main) return;
  main.insertAdjacentHTML('afterbegin', `<aside class="consent" aria-label="Cookie">
    <p>Можно мы включим Яндекс Метрику? Она ставит cookie и показывает нам, какими разделами пользуются. <a href="/privacy.html">Подробнее</a></p>
    <div class="consent-actions"><button type="button" class="btn-inline" data-consent="yes">Хорошо</button><button type="button" class="btn-inline" data-consent="no">Без Метрики</button></div>
  </aside>`);
  main.querySelector('.consent').addEventListener('click', (event) => {
    const answer = event.target.closest('[data-consent]')?.dataset.consent;
    if (!answer) return;
    store(answer);
    event.currentTarget.remove();
    if (answer === 'yes') load();
  });
}

if (id) {
  // Ссылки и разделы, которые нужны только при включённой Метрике (например, «Конфиденциальность» в подвале).
  for (const element of document.querySelectorAll('[data-metrika]')) element.hidden = false;
  for (const element of document.querySelectorAll('[data-metrika-off]')) element.hidden = true;
  const answer = read();
  if (answer === 'yes') load();
  else if (answer !== 'no') notice();
}
