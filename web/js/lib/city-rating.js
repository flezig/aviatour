import { esc } from './ui.js';

const badgeSelector = 'a.city-rating[data-rating-city][data-rating-month]';
const cityCode = /^[A-ZА-ЯЁ0-9]{3}$/u;
const airportCode = /^[A-Z]{3}$/;
const scoreFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const months = 'январь февраль март апрель май июнь июль август сентябрь октябрь ноябрь декабрь'.split(' ');

// Without JavaScript each badge links directly to the server-rendered breakdown.
export function cityRating(code, { month, year }, from, name, all) {
  if (!cityCode.test(code) || !Number.isInteger(month) || month < 1 || month > 12) return '';
  const query = new URLSearchParams({ month });
  if (Number.isInteger(year)) query.set('year', year);
  if (airportCode.test(from)) {
    query.set('from', from);
    if (airportCode.test(all)) query.set('fc', all);
  }
  return `<a class="city-rating" data-rating-city="${esc(code)}" data-rating-month="${month}"
    ${query.has('year') ? `data-rating-year="${year}"` : ''} data-rating-name="${esc(name)}"
    href="/season/${encodeURIComponent(code)}?${esc(query)}#city-rating"><span class="city-rating-label">Рейтинг города</span><span class="city-rating-value">…</span></a>`;
}

const requests = new Map();
function read(url) {
  if (!requests.has(url)) {
    const request = fetch(url).then(response => {
      if (!response.ok) throw new Error();
      return response.json();
    }).catch(error => {
      requests.delete(url);
      throw error;
    });
    requests.set(url, request);
  }
  return requests.get(url);
}
function reportFor(badge) {
  const { ratingCity, ratingMonth, ratingYear } = badge.dataset;
  const query = new URLSearchParams({ month: ratingMonth });
  if (ratingYear) query.set('year', ratingYear);
  return read('/api/v1/city-rating/' + encodeURIComponent(ratingCity) + '?' + query);
}
const hasScore = report => report.available === 4 && Number.isFinite(report.score);
const scoreValue = report => hasScore(report)
  ? `${scoreFormat.format(report.score)}<small>/10</small>` : `${esc(report.available)} из 4`;

function setValue(badge, report) {
  badge.querySelector('.city-rating-value').innerHTML = scoreValue(report);
  const meaning = hasScore(report) ? scoreFormat.format(report.score) + ' из 10'
    : 'показателей с оценкой ' + report.available + ' из 4';
  const label = hasScore(report) ? 'Рейтинг города' : 'Данные о городе';
  badge.querySelector('.city-rating-label').textContent = label;
  badge.setAttribute('aria-label', label + ' ' + badge.dataset.ratingName + ', ' + meaning);
}

async function enhance(badge) {
  if ('showPopover' in HTMLElement.prototype) {
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-expanded', String(active === badge));
  }
  const value = badge.querySelector('.city-rating-value');
  if (!value) return;
  if (badge.closest('.rating-tile')) {
    // For an international city with four inputs, the API also checks current travel advice.
    if (value.textContent === '4 из 4') {
      try { setValue(badge, await reportFor(badge)); } catch { /* Keep the server-rendered coverage. */ }
    }
    return;
  }
  const { ratingCity, ratingMonth, ratingYear } = badge.dataset;
  try {
    const index = await read('/api/v1/city-rating-index' + (ratingYear ? '?year=' + encodeURIComponent(ratingYear) : ''));
    const count = index[ratingCity]?.[Number(ratingMonth) - 1];
    if (!/^[0-4]$/.test(count)) throw new Error();
    if (!badge.isConnected) return;
    setValue(badge, { available: Number(count) });
    if (count === '4') {
      // A complete set can still have its score withheld by the travel advisory.
      const report = await reportFor(badge);
      if (badge.isConnected) setValue(badge, report);
    }
  } catch {
    if (value.textContent === '…') value.textContent = '—';
  }
}

function sources(items) {
  const links = items.filter(item => /^https?:\/\//i.test(item.url) || /^\/(?!\/)/.test(item.url));
  if (!links.length) return '';
  return '<ul>' + links.map(item => `<li><a href="${esc(item.url)}">${esc(item.label)}</a>${item.note ? ' — ' + esc(item.note) : ''}</li>`).join('') + '</ul>';
}

function verdict(report) {
  return report.notice || report.verdict || (hasScore(report)
    ? 'Все четыре показателя вошли в оценку.' : 'Для общей оценки нужны все четыре показателя.');
}
function summary(report) {
  const rows = report.components.map(item => `<tr><th scope="row">${esc(item.label)}<small>${esc(item.fact || item.budget_label || item.gap || item.missing[0] || item.detail)}</small></th>
    <td>${Number.isFinite(item.score) ? scoreFormat.format(item.score) : '—'}</td><td>${esc(item.weight)}%</td></tr>`).join('');
  return `<div class="rating-lead"><strong>${scoreValue(report)}</strong><p>${esc(verdict(report))}</p></div>
    <div class="city-rating-criteria"><table><thead><tr><th scope="col">Показатель</th><th scope="col">Балл /10</th>
    <th scope="col">Вес</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function evidence(report, pageUrl) {
  const comparisonUrl = new URL(pageUrl);
  comparisonUrl.hash = 'rating-comparison';
  const formula = hasScore(report) ? report.components.map(item => scoreFormat.format(item.score) + ' × ' + item.weight + '%').join(' + ')
    + ' ≈ ' + scoreFormat.format(report.score) + '.' : '';
  return `<div class="rating-document" tabindex="0" aria-label="Расчёт и список источников"><h3>Общая оценка</h3>
    <p>${hasScore(report) ? 'Умножаем баллы на веса, складываем и округляем результат до десятых. ' + formula : esc(verdict(report))}</p>`
    + report.components.map(item => `<section><h3>${esc(item.label)} (${esc(item.weight)}%)</h3><p>${esc(item.detail)}</p>
      ${item.missing.length ? `<p><b>Чего не хватает.</b> ${esc(item.missing.join(' '))}</p>` : ''}
      ${item.trip_detail ? `<p><b>Цены на конкретные выходные.</b> ${esc(item.trip_detail)}</p>` : ''}
      ${item.comparison ? `<p><a href="${esc(comparisonUrl.href)}">Сравнить расходы в ${item.comparison.length} городах</a></p>` : ''}
      ${sources(item.sources)}</section>`).join('') + '</div>';
}

const panel = document.createElement('section');
panel.id = 'city-rating-popover';
panel.className = 'city-rating-popover';
panel.setAttribute('aria-labelledby', 'city-rating-heading');
const sheet = document.createElement('dialog');
sheet.className = 'rating-sheet';
sheet.setAttribute('aria-labelledby', 'city-rating-heading');
const narrow = matchMedia('(max-width: 820px)');
const closeButton = '<button type="button" class="rating-close" aria-label="Закрыть рейтинг">×</button>';
let active, pinned, timer, report, view, surface, restoring = false;

function contains(target) {
  return target instanceof Node && (active?.contains(target) || panel.contains(target));
}
function dismiss(refocus = false) {
  clearTimeout(timer);
  if (!active) return;
  const trigger = active;
  active = null;
  pinned = false;
  if (surface === 'popover') panel.hidePopover();
  if (sheet.open) sheet.close();
  panel.remove();
  sheet.remove();
  trigger.setAttribute('aria-expanded', 'false');
  trigger.removeAttribute('aria-controls');
  if (refocus && trigger.isConnected) {
    restoring = true;
    trigger.focus({ preventScroll: true });
    restoring = false;
  }
}
function position() {
  if (!active || surface !== 'popover') return;
  const box = active.getBoundingClientRect();
  const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
  if (!box.width || box.bottom <= 0 || box.top >= height || box.right <= 0 || box.left >= width) {
    dismiss();
    return;
  }
  const margin = 8, gap = 4;
  const below = height - box.bottom - gap - margin, above = box.top - gap - margin;
  const up = below < 420 && above > below;
  panel.style.maxHeight = Math.max(80, up ? above : below) + 'px';
  panel.style.left = Math.max(margin, Math.min(box.left, width - panel.offsetWidth - margin)) + 'px';
  panel.style.top = (up ? Math.max(margin, box.top - gap - panel.offsetHeight) : box.bottom + gap) + 'px';
}

function mount(badge) {
  const slot = badge.closest('.rating-directory')?.querySelector('.rating-slot');
  surface = slot ? (narrow.matches ? 'sheet' : 'slot') : 'popover';
  panel.removeAttribute('style');
  panel.toggleAttribute('popover', surface === 'popover');
  if (surface === 'sheet') {
    sheet.append(panel);
    document.body.append(sheet);
    sheet.showModal();
  } else if (surface === 'slot') {
    slot.append(panel);
  } else {
    panel.setAttribute('popover', 'manual');
    badge.after(panel);
    panel.showPopover();
  }
  position();
}

function fillBody() {
  const body = panel.querySelector('.rating-body');
  body.innerHTML = view === 'sources' ? evidence(report, active.href) : summary(report);
  panel.querySelector('.rating-open-sources').hidden = view === 'sources';
  const period = months[report.month - 1] + ' ' + report.year;
  const back = view === 'sources';
  panel.querySelector('.rating-back').hidden = !back;
  panel.querySelector('.rating-type').hidden = back;
  panel.querySelector('h2').textContent = back ? 'Источники и расчёт' : report.city;
  const caption = panel.querySelector('.rating-caption');
  caption.textContent = back ? report.city + ', ' + period : period;
  panel.scrollTop = 0;
  position();
}

async function open(badge) {
  clearTimeout(timer);
  if (badge === active) return;
  dismiss();
  active = badge;
  view = 'summary';
  report = null;
  panel.innerHTML = `<div class="rating-topline"><span class="rating-type">Рейтинг города</span>
    <button class="rating-back" type="button" hidden>← К рейтингу</button>${closeButton}</div>
    <header class="rating-panel-head"><h2 id="city-rating-heading">${esc(badge.dataset.ratingName)}</h2><p class="rating-caption"></p></header>
    <div class="rating-body" aria-live="polite">Загружаем показатели…</div><footer class="rating-panel-foot">
    <button class="rating-open-sources" type="button" hidden>Источники и расчёт</button><a href="${esc(badge.href)}">Подробнее о сезоне</a></footer>`;
  badge.setAttribute('aria-expanded', 'true');
  badge.setAttribute('aria-controls', panel.id);
  mount(badge);
  try {
    const data = await reportFor(badge);
    if (active !== badge) return;
    report = data;
    fillBody();
    setValue(badge, data);
  } catch {
    if (active !== badge) return;
    panel.querySelector('.rating-body').textContent = 'Не удалось загрузить показатели. Подробности доступны на странице сезона.';
    position();
  }
}

function scan(root) {
  if (root.matches(badgeSelector)) enhance(root);
  for (const badge of root.querySelectorAll(badgeSelector)) enhance(badge);
}
export function previewFirstRating() {
  if (active && !active.isConnected) dismiss();
  if (active || narrow.matches || !('showPopover' in HTMLElement.prototype)) return;
  const first = document.querySelector('.rating-tiles .city-rating');
  if (first) open(first);
}
scan(document.documentElement);
new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) if (node instanceof Element) scan(node);
  }
  if (active && !active.isConnected) dismiss();
}).observe(document.body, { childList: true, subtree: true });

panel.addEventListener('click', event => {
  if (event.target.closest('a')) setTimeout(() => dismiss(), 0);
  else if (event.target.closest('.rating-close')) dismiss(true);
  else if (event.target.closest('.rating-open-sources, .rating-back') && report) {
    pinned = true;
    view = view === 'summary' ? 'sources' : 'summary';
    fillBody();
    panel.querySelector(view === 'sources' ? '.rating-back' : '.rating-open-sources').focus({ preventScroll: true });
  }
});
sheet.addEventListener('cancel', event => { event.preventDefault(); dismiss(true); });
sheet.addEventListener('click', event => { if (event.target === sheet) dismiss(true); });

if ('showPopover' in HTMLElement.prototype) {
  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse' || narrow.matches) return;
    if (contains(event.target)) clearTimeout(timer);
    const badge = event.target.closest(badgeSelector);
    if (!pinned && badge && !badge.contains(event.relatedTarget)) open(badge);
  });
  document.addEventListener('pointerout', event => {
    if (surface === 'slot' || event.pointerType !== 'mouse' || pinned || !contains(event.target) || contains(event.relatedTarget)) return;
    timer = setTimeout(() => { if (!pinned && !contains(document.activeElement)) dismiss(); }, 300);
  });
  document.addEventListener('focusin', event => {
    if (restoring) return;
    const badge = event.target.closest(badgeSelector);
    if (!narrow.matches && badge?.matches(':focus-visible')) open(badge);
    else if (active && !contains(event.target) && surface === 'popover') dismiss();
  });
  document.addEventListener('click', event => {
    const badge = event.target.closest(badgeSelector);
    if (!badge) {
      if (!contains(event.target) && active && surface === 'popover') dismiss();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (pinned && active === badge) dismiss(true);
    else {
      open(badge);
      pinned = true;
      if (active) panel.querySelector('.rating-close').focus({ preventScroll: true });
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss(panel.contains(document.activeElement) || surface === 'sheet');
    } else if (event.key === ' ' && event.target.matches(badgeSelector)) {
      event.preventDefault();
      if (!event.repeat) event.target.click();
    }
  }, true);
  document.addEventListener('close', event => {
    if (active && event.target.contains(active)) dismiss();
  }, true);
  document.addEventListener('scroll', event => { if (!panel.contains(event.target)) position(); }, true);
  narrow.addEventListener('change', () => {
    const trigger = active, selected = pinned;
    dismiss();
    if (trigger && selected) { open(trigger); pinned = true; }
    else previewFirstRating();
  });
  window.addEventListener('resize', position);
}
