import { zoned } from './format.js';

const code = /^[A-Z]{3}$/;
const zones = new Map();
function validZone(zone) {
  if (typeof zone !== 'string' || !zone) return false;
  if (!zones.has(zone)) {
    try { new Intl.DateTimeFormat('ru', { timeZone: zone }); zones.set(zone, true); }
    catch { zones.set(zone, false); }
  }
  return zones.get(zone);
}

// Saved offers from older versions can lack a city code for the origin or a flight duration.
export function usableOffer(offer, now = Date.now()) {
  return Boolean(offer && typeof offer.id === 'string' && offer.id && offer.city && offer.origin_city
    && [offer.city_code, offer.origin_airport, offer.destination_airport].every(v => code.test(v))
    && [offer.origin_timezone, offer.destination_timezone].every(validZone)
    && (!offer.source || offer.source === 'LIVE') && (!offer.currency || offer.currency === 'RUB')
    && Number.isSafeInteger(offer.price_minor) && offer.price_minor > 0 && offer.price_minor <= 1e11
    && Date.parse(offer.departure_at) > now && Date.parse(offer.return_at) > Date.parse(offer.departure_at)
    && Number.isFinite(Date.parse(offer.received_at)) && offer.availability !== 'unavailable'
    && (!offer.expires_at || Date.parse(offer.expires_at) > now));
}

export function stayWindow(offer) {
  if (!Number.isSafeInteger(offer.duration_to) || offer.duration_to <= 0) return null;
  const arrival = Date.parse(offer.departure_at) + offer.duration_to * 60000;
  const end = Date.parse(offer.return_at);
  return arrival < end ? { arrival, end } : null;
}

export function stayNights(offer) {
  const window = stayWindow(offer);
  if (!window) return null;
  const day = instant => Date.parse(zoned(new Date(instant), offer.destination_timezone).key);
  return Math.round((day(window.end) - day(window.arrival)) / 86400000);
}

// Fares are minor units; annotated user estimates are whole roubles, shared by the group.
export function groupBudget(offer, people, nightRate, extras) {
  const nights = stayNights(offer);
  const tickets = offer.price_minor * people;
  const stay = nights === 0 || nightRate === 0 ? 0 : nights === null || nightRate === null ? null : nights * nightRate * 100;
  const other = extras === null ? null : extras * 100;
  return { nights, tickets, stay, other, known: tickets + (stay ?? 0) + (other ?? 0), complete: stay !== null && other !== null };
}

const byPrice = (a, b) => a.cost - b.cost || b.minutes - a.minutes;
const byHours = (a, b) => b.minutes - a.minutes || a.cost - b.cost;

// Keep both useful extremes per city without materialising the cross product of the two search results.
export function meetingCities(first, second, firstPeople, secondPeople) {
  const rightByCity = new Map();
  for (const offer of second) {
    const window = stayWindow(offer);
    if (!window) continue;
    if (!rightByCity.has(offer.city_code)) rightByCity.set(offer.city_code, []);
    rightByCity.get(offer.city_code).push({ offer, window });
  }
  const cities = new Map();
  for (const left of first) {
    const leftWindow = stayWindow(left);
    if (!leftWindow) continue;
    for (const { offer: right, window } of rightByCity.get(left.city_code) ?? []) {
      if (left.origin_airport === right.origin_airport || (left.origin_city_code && left.origin_city_code === right.origin_city_code)) continue;
      const start = Math.max(leftWindow.arrival, window.arrival);
      const end = Math.min(leftWindow.end, window.end);
      const minutes = Math.floor((end - start) / 60000);
      if (minutes < 1) continue;
      const pair = { left, right, start, end, minutes, cost: left.price_minor * firstPeople + right.price_minor * secondPeople };
      const city = cities.get(left.city_code);
      if (!city) cities.set(left.city_code, { cheap: pair, longest: pair });
      else {
        if (byPrice(pair, city.cheap) < 0) city.cheap = pair;
        if (byHours(pair, city.longest) < 0) city.longest = pair;
      }
    }
  }
  return cities;
}
