import { nightsLabel, fmtDay, fmtRange, zoned, localZone } from './lib/format.js';
import { passengerLabel, passengersFromParams } from './lib/passengers.js';
import { $, adMark, esc } from './lib/ui.js';
import { partnerLink } from './lib/links.js';
import { openStayCalendar } from './lib/stay-calendar.js';

const form = $('hotelSearch');
const citiesDialog = $('stayCities');
if (form && citiesDialog) setupStays();

function setupStays() {
  const place = form.querySelector('.stay-place');
  const checkin = form.querySelector('[data-stay-date=checkin]');
  const guests = form.elements.adults;
  const submit = form.querySelector('[type=submit]');
  const quick = $('stayQuick');
  const query = $('stayCityQuery');
  const list = $('stayCityList');
  const storageKey = 'aviator.stay';
  const url = new URL(location.href);
  const fromTrip = url.searchParams.get('service') === 'stays' && url.searchParams.has('stay-city');

  let stored;
  try { stored = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* Достаточно состояния формы. */ }
  const source = fromTrip ? {
    city: url.searchParams.get('stay-city'),
    checkin: url.searchParams.get('checkin'),
    checkout: url.searchParams.get('checkout'),
    ...passengersFromParams(url.searchParams)
  } : stored;
  const date = key => new Date(key + 'T00:00:00Z');
  const today = zoned(new Date(), localZone).key;
  const validDate = key => /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(+date(key)) && date(key).toISOString().startsWith(key) && key >= today;
  const stay = {
    city: /^[A-Z]{3}$/.test(source?.city) ? source.city : '',
    checkin: validDate(source?.checkin) ? source.checkin : '',
    checkout: '',
    adults: Number.isInteger(source?.adults) && source.adults >= 1 && source.adults <= 9 ? source.adults : 1,
    ages: Array.isArray(source?.ages) ? source.ages.filter(age => Number.isInteger(age) && age >= 0 && age <= 11).slice(0, 8) : []
  };
  if (stay.checkin && validDate(source?.checkout) && source.checkout > stay.checkin) stay.checkout = source.checkout;
  let catalog;
  let request;
  const normalize = text => text.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();

  function loadCities() {
    if (!request) request = Promise.all(['cities', 'hotel-locations', 'origins'].map(async name => {
      const response = await fetch('/data/' + name + '.json');
      if (!response.ok) throw Error(name);
      return response.json();
    })).then(([directory, locations, origins]) => {
      const names = new Map([...origins.cities, ...directory.cities].map(city => [city.code, city.name]));
      catalog = Object.entries(locations).filter(([code, location]) => names.has(code) && Number.isInteger(location))
        .map(([code, location]) => ({ code, name: names.get(code), location }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      return catalog;
    }).catch(error => { request = null; throw error; });
    return request;
  }

  function status(message = '') {
    $('stayStatus').textContent = message;
    $('stayStatus').hidden = !message;
  }

  function save() {
    try { sessionStorage.setItem(storageKey, JSON.stringify(stay)); return true; }
    catch { return false; }
  }

  function render() {
    const selected = catalog?.find(city => city.code === stay.city);
    const quickName = !catalog ? quick?.querySelector(`[data-stay-city="${stay.city}"]`)?.textContent.trim() : null;
    $('stayPlace').textContent = selected?.name ?? quickName ?? (stay.city && !catalog ? 'Загружаем город…' : 'Куда едете?');
    if (quick) quick.hidden = Boolean(selected || (stay.city && !catalog));
    $('stayCheckin').textContent = stay.checkin ? fmtDay(date(stay.checkin), 'UTC', true) : 'Выберите дату';
    $('stayCheckout').textContent = stay.checkout ? fmtDay(date(stay.checkout), 'UTC', true) : 'Выберите дату';
    guests.value = stay.adults;
    const count = stay.checkout ? Math.round((date(stay.checkout) - date(stay.checkin)) / 86400000) : 0;
    $('stayNights').textContent = count ? fmtRange(date(stay.checkin), date(stay.checkout), 'UTC', 'UTC') + ', ' + nightsLabel(count) : '';
    $('stayNights').hidden = !count;
    $('stayFamily').textContent = stay.ages.length
      ? passengerLabel(stay) + '. В поиск передадим взрослых. Детей и их возраст добавьте на Авиасейлс.' : '';
    $('stayFamily').hidden = !stay.ages.length;
  }

  function changed() { status(); save(); render(); }

  function showCities() {
    if (!catalog) return;
    const term = normalize(query.value);
    const matches = catalog.filter(city => normalize(city.name).includes(term) || normalize(city.code).includes(term));
    list.innerHTML = matches.map(city => `<button class="airport-option" type="button" data-stay-city="${esc(city.code)}"${city.code === stay.city ? ' aria-current="true"' : ''}><b>${esc(city.name)}</b></button>`).join('');
    $('stayCityStatus').textContent = matches.length ? '' : 'Город не найден. Попробуйте другой город или курорт.';
  }

  async function openCities() {
    query.value = '';
    citiesDialog.showModal();
    query.focus();
    if (catalog) { showCities(); return; }
    list.textContent = '';
    $('stayCityStatus').textContent = 'Загружаем города…';
    try { await loadCities(); showCities(); }
    catch { $('stayCityStatus').textContent = 'Не удалось загрузить города. Закройте список и откройте его ещё раз.'; }
  }

  guests.innerHTML = Array.from({ length: 9 }, (_, index) => {
    const adults = index + 1;
    return `<option value="${adults}">${passengerLabel({ adults, ages: [] })}</option>`;
  }).join('');
  guests.addEventListener('change', () => { stay.adults = Number(guests.value); changed(); });
  place.addEventListener('click', openCities);
  $('stayAllCities').addEventListener('click', openCities);
  query.addEventListener('input', showCities);
  query.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    list.querySelector('button')?.focus();
  });
  list.addEventListener('click', event => {
    const choice = event.target.closest('[data-stay-city]');
    if (!choice) return;
    stay.city = choice.dataset.stayCity;
    changed();
    citiesDialog.close();
  });
  citiesDialog.addEventListener('close', () => place.focus({ preventScroll: true }));

  function pickDates(trigger) {
    openStayCalendar(trigger, { ...stay, step: trigger.dataset.stayDate }, dates => {
      Object.assign(stay, dates);
      changed();
    });
  }
  quick?.addEventListener('click', event => {
    const choice = event.target.closest('[data-stay-city]');
    if (!choice) return;
    stay.city = choice.dataset.stayCity;
    changed();
    if (stay.checkout) submit.focus();
    else {
      checkin.focus({ preventScroll: true });
      pickDates(checkin);
    }
    if (!catalog) loadCities().then(render).catch(() => status('Города пока не загрузились. Попробуйте открыть список городов.'));
  });
  form.querySelectorAll('[data-stay-date]').forEach(button => button.addEventListener('click', () => pickDates(button)));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!stay.city) { await openCities(); return; }
    if (!stay.checkout) { pickDates(checkin); return; }
    submit.disabled = true;
    status();
    try {
      const city = (await loadCities()).find(item => item.code === stay.city);
      if (!city) { await openCities(); return; }
      const params = new URLSearchParams({
        location_id: city.location, location_type: 'city', checkin: stay.checkin, checkout: stay.checkout, adults: stay.adults
      });
      const href = partnerLink('https://www.aviasales.ru/hotels/search?' + params, { kind: 'hotels', city: stay.city, page: 'home', block: 'stay' });
      if (!href) throw Error('hotel link');
      const saved = save();
      const address = new URL(location.href);
      address.searchParams.set('service', 'stays');
      if (!saved) {
        address.searchParams.set('stay-city', stay.city);
        address.searchParams.set('checkin', stay.checkin);
        address.searchParams.set('checkout', stay.checkout);
        address.searchParams.set('adults', stay.adults);
        if (stay.ages.length) address.searchParams.set('ages', stay.ages.join(','));
      }
      history.replaceState(history.state, '', address);
      location.assign(href);
    } catch { status('Не удалось открыть поиск жилья. Попробуйте ещё раз.'); }
    finally { submit.disabled = false; }
  });

  $('stayStatus').insertAdjacentHTML('afterend', adMark('aviasales'));
  if (fromTrip && save()) {
    for (const key of ['stay-city', 'checkin', 'checkout', 'adults', 'ages']) url.searchParams.delete(key);
    history.replaceState(history.state, '', url);
  }
  render();
  if (stay.city || url.searchParams.get('service') === 'stays') {
    loadCities().then(render).catch(() => status('Города пока не загрузились. Попробуйте открыть список городов.'));
  }
}
