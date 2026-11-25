import { addDays } from './lib/format.js';
import { adMark } from './lib/ui.js';
import { partnerLink } from './lib/links.js';

const tabs = [...document.querySelectorAll('.service-tabs [role=tab]')];
const heading = document.querySelector('.intro h1');
const lead = document.querySelector('.intro-lead');
const alternateHeading = document.createElement("h1");
alternateHeading.hidden = true;
heading.after(alternateHeading);
const originalLead = lead.textContent;
const labels = {
  stays: ['Где остановиться', 'Выберите город, даты проживания и количество гостей.'],
  cars: ['Аренда авто', 'Выберите место получения и даты аренды.'],
  tours: ['Куда поехать в тур', 'Выберите направление, даты поездки и количество туристов.']
};
let selected = 'flights';
function sizeHero() {
  if (selected === 'flights') {
    if (!document.querySelector('.search--collapsed')) return;
  }
  const active = tabs.find(t => t.getAttribute('aria-selected') === 'true');
  const panel = document.getElementById(active.getAttribute('aria-controls'));
  if (panel.offsetHeight) document.documentElement.style.setProperty('--hero-h', (panel.getBoundingClientRect().bottom + scrollY + 28) + 'px');
}
function choose(tab) {
  selected = tab.dataset.service;
  if (location.hash.startsWith('#fav') && !document.body.classList.contains('has-hero')) { location.assign('/?service=' + selected); return; }
  const flight = selected === 'flights';
  for (const button of tabs) {
    const on = button === tab;
    button.setAttribute('aria-selected',String(on));
    button.tabIndex = on ? 0 : -1;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !on;
  }
  document.body.classList.toggle('other-service', !flight);
  heading.hidden = !flight; alternateHeading.hidden = flight;
  if (!flight) alternateHeading.textContent = labels[selected][0];
  lead.textContent = flight ? originalLead : labels[selected][1];
  requestAnimationFrame(sizeHero);
}
for (const [i, tab] of tabs.entries()) {
  tab.addEventListener('click', () => choose(tab));
  tab.addEventListener('keydown', e => {
    const n = { ArrowRight:(i+1)%4, ArrowLeft:(i+3)%4, Home:0, End:3 }[e.key];
    if (n === undefined) return;
    e.preventDefault(); tabs[n].focus(); choose(tabs[n]);
  });
}
function futureDay(days) {
  const d = new Date(); d.setDate(d.getDate()+days);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
for (const form of document.querySelectorAll('.service-form')) {
  const start = form.elements.start, end = form.elements.end;
  const isHotel = form.id === 'hotelSearch';
  const firstCheckout = () => isHotel && start.value ? addDays(start.value, 1) : start.value;
  start.min = futureDay(0); start.value = futureDay(14); end.min = firstCheckout(); end.value = futureDay(21);
  const status = form.nextElementSibling;
  if (isHotel) status.insertAdjacentHTML('afterend', adMark('aviasales'));
  form.addEventListener('input', () => {
    status.hidden = true; end.min = firstCheckout();
    if (start.value && end.value && end.value < end.min) end.value = end.min;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (isHotel) {
      const city = form.elements.place.value;
      const query = new URLSearchParams({
        location_type: 'city', checkin: start.value, checkout: end.value, adults: form.elements.adults.value
      });
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const response = await fetch('/data/hotel-locations.json');
        if (!response.ok) throw new Error('locations');
        const locationId = (await response.json())[city];
        if (!Number.isInteger(locationId)) throw new Error('city');
        query.set('location_id', locationId);
        const href = partnerLink('https://www.aviasales.ru/hotels/search?' + query, { kind: 'hotels', city, page: 'home', block: 'stay' });
        if (!href) throw new Error('url');
        location.assign(href);
      } catch {
        status.textContent = 'Не удалось открыть поиск жилья. Попробуйте ещё раз.';
        status.hidden = false;
      } finally {
        submit.disabled = false;
      }
      return;
    }
    status.textContent = 'Это предпросмотр вкладки. Поиск предложений пока не подключён.';
    status.hidden = false;
  });
}
window.addEventListener('resize', sizeHero);
const observer = new ResizeObserver(() => { if (selected !== 'flights') sizeHero(); });
document.querySelectorAll('.service-panel').forEach(panel => observer.observe(panel));
const requested = new URLSearchParams(location.search).get('service');
const initial = tabs.find(tab => tab.dataset.service === requested);
if (initial) choose(initial);
