import { esc, icon } from './ui.js';

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
    href="/season/${encodeURIComponent(code)}?${esc(query)}#city-rating">${icon('plane')}<span class="city-rating-label">Рейтинг города</span><span class="city-rating-value">…</span>${icon('chevron-down')}</a>`;
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
  badge.setAttribute('aria-label', 'Рейтинг города, ' + meaning);
}

async function enhance(badge) {
  if ('showPopover' in HTMLElement.prototype) {
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-expanded', 'false');
  }
  const value = badge.querySelector('.city-rating-value');
  if (!value) return;
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

function sources(links) {
  return links.filter(link => /^https?:\/\//i.test(link.url) || /^\/(?!\/)/.test(link.url))
    .map(link => `<a href="${esc(link.url)}">${esc(link.label)}</a>`).join(' · ');
}
const descriptions = {
  activities: 'Музеи, природа и события', cost: 'Жильё, питание и транспорт',
  climate: 'Температура и осадки', mobility: 'Путь пешком и на транспорте',
};
const gapsByKey = {
  activities: 'Нет полных сведений о занятиях по выходным.',
  cost: 'Не собрана сопоставимая корзина расходов.',
  climate: 'Не хватает климатических наблюдений.',
  mobility: 'Не подтверждено время на всех маршрутах.',
};
function criteria(report) {
  const rows = report.components.map(component => {
    const links = sources(component.sources);
    const detailLabel = links ? `Данные и источники · ${component.sources.length}` : 'Данные';
    const description = component.missing.length ? (component.gap || gapsByKey[component.key]) : descriptions[component.key];
    return `<tr><th scope="row">${esc(component.label)}<small>${esc(description)}</small>
      <details><summary>${detailLabel}</summary><p>${esc(component.detail)}</p>
        ${links ? `<p>${links}</p>` : ''}</details></th>
      <td>${Number.isFinite(component.score) ? scoreFormat.format(component.score) : '—'}</td><td>${esc(component.weight)}%</td></tr>`;
  }).join('');
  const gaps = report.components.filter(component => component.missing.length)
    .map(component => `<dt>${esc(component.label)}</dt><dd>${esc(component.missing.join(' '))}</dd>`).join('');
  const notice = report.notice || (report.available < 4 ? 'Для общего балла нужны все четыре показателя.' : '');
  return `${notice ? `<p class="city-rating-notice">${esc(notice)}</p>` : ''}
    <table><thead><tr><th scope="col">Критерий</th><th scope="col">Балл /10</th><th scope="col">Вес</th></tr></thead><tbody>${rows}</tbody></table>
    ${gaps ? `<section class="city-rating-gaps"><h3>Чего не хватает</h3><dl>${gaps}</dl></section>` : ''}`;
}

const panel = document.createElement('section');
panel.id = 'city-rating-popover';
panel.className = 'city-rating-popover';
panel.setAttribute('popover', 'manual');
panel.setAttribute('aria-labelledby', 'city-rating-heading');
let active, pinned, closeTimer;
function contains(target) {
  return target instanceof Node && (active?.contains(target) || panel.contains(target));
}
function dismiss() {
  clearTimeout(closeTimer);
  if (!active) return;
  panel.hidePopover();
  panel.remove();
  active.setAttribute('aria-expanded', 'false');
  active.removeAttribute('aria-controls');
  active = null;
  pinned = false;
}
function position() {
  if (!active) return;
  const box = active.getBoundingClientRect();
  const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
  if (!active.isConnected || !box.width || box.bottom <= 0 || box.top >= height || box.right <= 0 || box.left >= width) {
    dismiss();
    return;
  }
  const margin = 8, gap = 4;
  const below = height - box.bottom - gap - margin, above = box.top - gap - margin;
  const up = below < 400 && above > below;
  panel.style.maxHeight = Math.max(80, up ? above : below) + 'px';
  panel.style.left = Math.max(margin, Math.min(box.left, width - panel.offsetWidth - margin)) + 'px';
  panel.style.top = (up ? Math.max(margin, box.top - gap - panel.offsetHeight) : box.bottom + gap) + 'px';
}
async function open(badge) {
  clearTimeout(closeTimer);
  if (badge === active) return;
  dismiss();
  active = badge;
  const { ratingCity, ratingMonth, ratingName, ratingYear } = badge.dataset;
  const subtitle = `${ratingName || ratingCity} · ${months[Number(ratingMonth) - 1]}`;
  panel.innerHTML = `<header><div><h2 id="city-rating-heading">Рейтинг города</h2><p></p></div><strong></strong></header>
    <div class="city-rating-criteria" aria-live="polite">Загружаем показатели…</div>
    <footer><a href="${esc(badge.href)}">Подробнее о сезоне ${icon('arrow-right')}</a></footer>`;
  const caption = panel.querySelector('header p'), total = panel.querySelector('header strong'), body = panel.querySelector('.city-rating-criteria');
  caption.textContent = subtitle + (ratingYear ? ' ' + ratingYear : '');
  badge.after(panel);
  badge.setAttribute('aria-expanded', 'true');
  badge.setAttribute('aria-controls', panel.id);
  panel.showPopover();
  position();
  try {
    const report = await reportFor(badge);
    if (active !== badge) return;
    caption.textContent = subtitle + (report.year ? ' ' + report.year : '');
    body.innerHTML = criteria(report);
    total.innerHTML = scoreValue(report);
    setValue(badge, report);
  } catch {
    if (active !== badge) return;
    body.textContent = 'Не удалось загрузить показатели. Подробности доступны на странице сезона.';
  }
  position();
}
function scan(root) {
  if (root.matches(badgeSelector)) enhance(root);
  for (const badge of root.querySelectorAll(badgeSelector)) enhance(badge);
}
scan(document.documentElement);
new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) if (node instanceof Element) scan(node);
  }
  if (active && !active.isConnected) dismiss();
}).observe(document.body, { childList: true, subtree: true });

if ('showPopover' in HTMLElement.prototype) {
  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse') return;
    if (contains(event.target)) clearTimeout(closeTimer);
    const badge = event.target.closest(badgeSelector);
    if (!pinned && badge && !badge.contains(event.relatedTarget)) open(badge);
  });
  document.addEventListener('pointerout', event => {
    if (event.pointerType !== 'mouse' || pinned || !contains(event.target) || contains(event.relatedTarget)) return;
    closeTimer = setTimeout(() => {
      if (!pinned && !contains(document.activeElement)) dismiss();
    }, 180);
  });
  document.addEventListener('focusin', event => {
    const badge = event.target.closest(badgeSelector);
    if (badge && badge.matches(':focus-visible')) open(badge);
    else if (active && !contains(event.target)) dismiss();
  });
  document.addEventListener('focusout', event => {
    if (event.relatedTarget && contains(event.target) && !contains(event.relatedTarget)) dismiss();
  });
  document.addEventListener('click', event => {
    const badge = event.target.closest(badgeSelector);
    if (!badge) {
      if (!contains(event.target)) dismiss();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (pinned && active === badge) dismiss();
    else { open(badge); pinned = true; }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) {
      event.preventDefault();
      event.stopPropagation();
      if (panel.contains(document.activeElement)) active.focus({ preventScroll: true });
      dismiss();
    } else if (event.key === ' ' && event.target.matches(badgeSelector)) {
      event.preventDefault();
      if (!event.repeat) event.target.click();
    }
  }, true);
  document.addEventListener('close', event => {
    if (active && event.target.contains(active)) dismiss();
  }, true);
  document.addEventListener('scroll', event => {
    if (active && !panel.contains(event.target)) position();
  }, true);
  panel.addEventListener('toggle', event => {
    if (event.target.matches('details')) position();
  }, true);
  window.addEventListener('resize', position);
}
