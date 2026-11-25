// The fragment carries only the itinerary and the traveller's budget. All outbound links come from our catalogue.
import { groupSize, validPassengers } from './passengers.js';
import { zoned, daysLabel, fmtRange } from './format.js';

const savedKey = 'aviator.plans.v1';
const askedKey = 'aviator.plan-prompts.v1';
const memory = new Map();

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]'); }
  catch { return memory.get(key) ?? []; }
}
function write(key, value) {
  memory.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

const code = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const amount = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
function zone(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  try { new Intl.DateTimeFormat('ru', { timeZone: value }); return true; } catch { return false; }
}
function valid(p) {
  return p?.v === 1 && /^[a-f0-9]{32}$/.test(p.id) && [p.cityCode, p.fromCode, p.toCode].every(code)
    && [p.city, p.from].every(label) && [p.out, p.arrive, p.back, p.quoted].every(instant)
    && Date.parse(p.out) <= Date.parse(p.arrive) && Date.parse(p.arrive) <= Date.parse(p.back)
    && (p.flight == null || (typeof p.flight === 'string' && flightPattern.test(p.flight)))
    && [p.fromZone, p.zone].every(zone) && Number.isSafeInteger(p.fare) && p.fare > 0 && p.fare <= 1e11
    && Number.isInteger(p.people) && p.people >= 1 && p.people <= 9
    && (p.passengers === undefined ? p.people <= 4 : validPassengers(p.passengers) && groupSize(p.passengers) === p.people)
    && [p.stay, p.food].every(n => n === null || amount(n));
}
const flightPattern = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/;
export function flightCode(offer) {
  if (offer.transfers !== 0 || !/^[A-Z0-9]{2}$/.test(offer.airline ?? '')) return null;
  const number = String(offer.flight_number ?? '').toUpperCase().replace(/\s+/g, '');
  if (/^\d{1,4}[A-Z]?$/.test(number)) return offer.airline + number;
  return number.startsWith(offer.airline) && flightPattern.test(number) ? number : null;
}
export function snapshot(offer) {
  const out = new Date(offer.departure_at);
  return { v: 1, id: offer.id, cityCode: offer.city_code, city: offer.city, from: offer.origin_city,
    fromCode: offer.origin_airport, toCode: offer.destination_airport, fromZone: offer.origin_timezone, zone: offer.destination_timezone,
    out: out.toISOString(), arrive: new Date(+out + (offer.duration_to || 0) * 60000).toISOString(),
    back: new Date(offer.return_at).toISOString(), quoted: new Date(offer.received_at).toISOString(),
    flight: flightCode(offer), fare: offer.price_minor, people: 1, stay: null, food: null };
}
export function tripPath(plan) {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  const data = btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
  const params = new URLSearchParams({ city: plan.cityCode, trip: plan.id });
  return '/trip.html?' + params + '#v1=' + data;
}
export function decodeTrip(hash) {
  if (!/^#v1=[a-zA-Z0-9_-]{1,6000}$/.test(hash)) return null;
  try {
    const raw = atob(hash.slice(4).replaceAll('-','+').replaceAll('_','/'));
    const p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, c => c.charCodeAt(0))));
    return valid(p) ? p : null;
  } catch { return null; }
}
export function savedTrips() {
  const list = read(savedKey);
  return Array.isArray(list) ? list.filter(valid) : [];
}
export function saveTrip(plan) {
  if (!valid(plan)) return false;
  return write(savedKey, [plan, ...savedTrips().filter(p => p.id !== plan.id)]);
}
export function firstPrompt(id) {
  const stored = read(askedKey);
  const ids = Array.isArray(stored) ? stored : [];
  if (ids.includes(id) || memory.get(askedKey)?.includes(id) || savedTrips().some(p => p.id === id)) return false;
  write(askedKey, [...ids, id]);
  return true;
}
export function tripDates(p) {
  const arrival = new Date(p.arrive), back = new Date(p.back);
  const start = zoned(arrival, p.zone).key, end = zoned(back, p.zone).key;
  return { start, end, nights: Math.round((Date.parse(end) - Date.parse(start)) / 86400000),
    label: fmtRange(arrival, back, p.zone, p.zone) };
}
export function countdown(p, now = new Date()) {
  if (+now > Date.parse(p.back)) return 'Обратный рейс уже вылетел';
  if (+now >= Date.parse(p.out)) return 'Поездка началась';
  const days = Math.round((Date.parse(zoned(new Date(p.out), p.fromZone).key) - Date.parse(zoned(now, p.fromZone).key)) / 86400000);
  return days ? 'До вылета ' + daysLabel(days) : 'Вылет сегодня';
}
export function budget(p) {
  const tickets = p.people === 1 ? p.fare : null;
  const { nights } = tripDates(p);
  const complete = tickets !== null && (!nights || p.stay !== null) && p.food !== null;
  return { tickets, complete, total: (tickets ?? 0) + 100 * (nights * (p.stay ?? 0) + (nights + 1) * p.people * (p.food ?? 0)) };
}
