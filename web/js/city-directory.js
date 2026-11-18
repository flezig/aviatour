import './lib/measure.js';

const form = document.getElementById('citySearch');
const query = form.elements.q;
const results = document.getElementById('cityResults');
const status = document.getElementById('cityStatus');
let timer;
let request;
let editing = false;

function formUrl() {
  const url = new URL(form.action);
  if (query.value) url.searchParams.set('q', query.value);
  if (form.elements.region.value !== 'all') url.searchParams.set('region', form.elements.region.value);
  if (form.elements.guide.checked) url.searchParams.set('guide', '1');
  return url;
}

function cancelPending() {
  clearTimeout(timer);
  request?.abort();
}

async function show(url, mode, focus) {
  cancelPending();
  const controller = new AbortController();
  request = controller;
  results.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('catalog response');
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    const next = html.getElementById('cityResults');
    if (!next) throw new Error('catalog results');
    if (controller.signal.aborted) return;
    if (mode && url.href !== location.href) history[mode](null, '', url);
    results.replaceChildren(...next.children);
    document.querySelector('link[rel="canonical"]').href = html.querySelector('link[rel="canonical"]').href;
    status.textContent = document.getElementById('resultsHeading').textContent + '. Найдено городов — ' + results.querySelector('[data-count]').textContent;
    if (focus) {
      const target = focus === 'query' ? query : focus === 'first' && results.querySelector('[data-city]');
      (target || document.getElementById('resultsHeading')).focus({ preventScroll: true });
      document.activeElement.scrollIntoView({ block: 'nearest' });
    }
  } catch (error) {
    if (!controller.signal.aborted) location.assign(url);
  } finally {
    if (request === controller) results.removeAttribute('aria-busy');
  }
}

query.addEventListener('input', () => {
  cancelPending();
  timer = setTimeout(() => {
    show(formUrl(), editing ? 'replaceState' : 'pushState');
    editing = true;
  }, 160);
});
query.addEventListener('blur', () => { editing = false; });
form.addEventListener('submit', (event) => {
  event.preventDefault();
  show(formUrl(), 'pushState', 'first');
});
form.addEventListener('change', (event) => {
  if (event.target !== query) show(formUrl(), 'pushState');
});

function restoreForm(url) {
  query.value = url.searchParams.get('q') || '';
  form.elements.region.value = url.searchParams.get('region') || 'all';
  form.elements.guide.checked = url.searchParams.get('guide') === '1';
  editing = false;
}

results.addEventListener('click', (event) => {
  if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a');
  if (!link) return;
  if (link.dataset.city) {
    history.replaceState({ city: link.dataset.city, y: scrollY }, '', location.href);
    return;
  }
  event.preventDefault();
  const url = new URL(link.href);
  restoreForm(url);
  show(url, 'pushState', link.hasAttribute('data-clear') ? 'query' : 'heading');
});

window.addEventListener('popstate', () => {
  const url = new URL(location.href);
  restoreForm(url);
  show(url, null);
});
window.addEventListener('pageshow', () => {
  const state = history.state;
  if (!state?.city) return;
  results.querySelector('[data-city="' + CSS.escape(state.city) + '"]')?.focus({ preventScroll: true });
  if (Number.isFinite(state.y)) scrollTo(0, state.y);
});
