'use strict';
// Яндекс Метрика. Загружается, только если в config.js указан номер счётчика; иначе цели просто не отправляются.
// Цели (в Метрике — «JavaScript-событие» с тем же идентификатором):
//   search — посетитель сам запустил поиск, trip — открыл карточку поездки, aviasales — перешёл на Aviasales,
//   longer — открыл подсказанную более длинную и дешёвую поездку, hotel — перешёл к отелям Aviasales.
//   similar — открыл город из блока «За эти же деньги».
//   shifted — открыл вариант из блока «Дешевле в соседние дни».
//   favorite — добавил поездку в избранное.
(() => {
  const value = String(window.AVIATOR?.metrika ?? '');
  const id = /^\d{5,12}$/.test(value) ? Number(value) : 0;
  window.aviatorGoal = (name) => { if (id) window.ym(id, 'reachGoal', name); };
  if (!id) return;
  // The official loader stub: calls made before tag.js arrives are queued and replayed by it.
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = Date.now();
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.append(script);
  window.ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
})();
