import { esc, adMark, icon } from './ui.js';
import { partnerLink } from './links.js';
import { tripDates } from './trip.js';
import { zoned } from './format.js';

let pending;
export function planCatalog() {
  if (!pending) {
    const json = path => fetch('/data/' + path + '.json').then(r => r.ok ? r.json() : null).catch(() => null);
    pending = Promise.all([json('cities'), json('hotel-locations'), json('tripster-cities'), json('city-guides')])
      .then(([cities, hotels, tours, guides]) => ({
        cities: new Map((cities?.cities ?? []).map(c => [c.code, c])), hotels: hotels ?? {}, tours: tours ?? {}, guides: guides ?? {}
      }));
  }
  return pending;
}

export function localActivities(p, data, page, variant = '') {
  const { start, end, nights, label } = tripDates(p);
  const today = zoned(new Date(), p.zone).key;
  if (end < today) return '';
  const from = start < today ? today : start;
  const adults = p.passengers?.adults ?? p.people;
  const stayLabel = (from === start ? label : 'На оставшиеся ночи') + (p.passengers?.ages.length ? '. Укажите возраст детей при поиске жилья.' : '');
  const options = [];
  function add(address, kind, brand, block, title, description) {
    const link = partnerLink(address, { kind, city: p.cityCode, page, block, variant });
    if (link) options.push(`<article class="plan-option"><div><h3>${esc(title)}</h3><p class="caption">${esc(description)}</p></div>
      <a class="btn-inline" href="${esc(link)}" target="_blank" rel="noopener" data-partner="${brand}" data-block="${block}">Посмотреть на ${{aviasales:'Aviasales', ostrovok:'Островке', tripster:'Трипстере'}[brand]} ${icon('arrow-right')}</a>${adMark(brand)}</article>`);
  }
  const city = data.cities.get(p.cityCode), location = data.hotels[p.cityCode];
  if (nights > 0 && from < end && location) {
    const params = new URLSearchParams({ location_id: location, location_type:'city', checkin:from, checkout:end, adults });
    add('https://www.aviasales.ru/hotels/search?' + params, 'hotels', 'aviasales', 'stay', 'Где остановиться', stayLabel);
  } else if (nights > 0 && from < end && city?.ostrovok) {
    const dotted = value => value.split('-').reverse().join('.');
    const params = new URLSearchParams({ dates: dotted(from) + '-' + dotted(end), guests: adults });
    add(adults > 4 ? city.ostrovok : city.ostrovok + '?' + params, 'ostrovok', 'ostrovok', 'stay', 'Где остановиться', stayLabel);
  }
  if (data.tours[p.cityCode]) {
    const params = new URLSearchParams({ start_date:from, end_date:end });
    add('https://experience.tripster.ru/experience/' + data.tours[p.cityCode] + '/?' + params, 'tours', 'tripster', 'tours', 'Экскурсии с гидом', from === start ? label : 'На оставшиеся дни');
  }
  return options.join('');
}
