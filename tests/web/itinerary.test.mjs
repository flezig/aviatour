import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, tripPath, localTripPath, localTripEvent, decodeTrip } from '../../web/js/lib/trip.js';
import { restoreItinerary, buildItinerary, bookingProblem, localStamp } from '../../web/js/lib/itinerary.js';
import { offlineText, rowsForDay } from '../../web/js/lib/itinerary-export.js';
import { walkMinutes } from '../../web/js/lib/itinerary-places.js';

const offer = {id:'f'.repeat(32), city_code:'KZN', city:'Казань', origin_city:'Москва', origin_airport:'SVO', destination_airport:'KZN',
  origin_timezone:'Europe/Moscow', destination_timezone:'Europe/Moscow', price_minor:654000, departure_at:'2026-11-27T17:00:00+03:00',
  return_at:'2026-11-29T09:00:00+03:00', duration_to:270, received_at:'2026-11-20T08:00:00Z'};
const p = snapshot(offer), zone = p.zone;
const choices = ['kremlin','cat','cathedral'];
const fixture = {id:'show',start:'2026-11-28T19:00',zone,title:'Театр',address:'Место по билету',duration:90};
const event = {title:'Концерт', address:'Личный адрес', start:'2026-11-28T18:00', duration:90, transferMinutes:60, bufferMinutes:15, returnReserveMinutes:175};

test('поздний прилёт и ранний вылет оставляют только средний день, переходы и обед помещаются', () => {
  const r = buildItinerary(p, restoreItinerary(p,{selected:choices}));
  assert.deepEqual(r.days.map(d => d.visits.length), [0,3,0]);
  const day = r.days[1];
  assert.equal(day.lunch.end - day.lunch.start,45*60000);
  for (const [i,v] of day.visits.entries()) {
    assert.ok(v.end <= day.lunch.start || v.start >= day.lunch.end);
    if (i) assert.ok(v.start - day.visits[i-1].end >= walkMinutes(day.visits[i-1].id,v.id)*60000);
    if (v.id === 'cathedral') assert.ok(localStamp(v.end,zone).slice(11) <= '18:00');
  }
  assert.equal(localStamp(r.departure,zone),'2026-11-29T06:00');
});
test('на двух полных днях расписание использует оба дня, неизвестный прилёт требует ввода', () => {
  const open = {...p,arrive:'2026-11-27T14:15Z',back:'2026-11-28T19:00Z'};
  const state = restoreItinerary(open,{selected:choices});
  assert.ok(buildItinerary(open,state).days.every(d => d.visits.length));
  const unknown = {...p,arrive:p.out};
  const s = restoreItinerary(unknown,{selected:choices});
  assert.equal(buildItinerary(unknown,s).days.flatMap(d=>d.visits).length,0);
  s.arrival = '2026-11-27T22:00';
  assert.equal(buildItinerary(unknown,s).missing.length,0);
});
test('бронь хранит свой часовой пояс, учитывает полночь, не допускает пересечение, предупреждает о коротком переходе', () => {
  const late = {...fixture,start:'2026-11-28T21:30',zone:'Europe/Berlin',duration:90};
  const state = restoreItinerary(p,{bookings:[late]});
  assert.equal(bookingProblem(p,state,{...fixture,id:'other',start:'2026-11-29T00:00'}).includes('уже есть'),true);
  const next = {...fixture,id:'next',start:'2026-11-29T01:05',duration:30};
  assert.equal(bookingProblem(p,state,next),'');
  state.bookings.push(next);
  const r = buildItinerary(p,state);
  assert.ok(r.warnings.some(s => s.includes('мало времени')));
  assert.equal(r.days.filter(d => rowsForDay(d,r,p).some(item => item.id === late.id)).length,2);
  assert.match(offlineText(p,state,r),/Europe\/Berlin/);
});
test('час от известного ориентира защищает бронь и закрытый собор, пользователь может вернуть исходный план', () => {
  const s = restoreItinerary(p,{selected:['freedom'],bookings:[fixture],replan:{from:'kremlin',at:'2026-11-28T17:30'}});
  const r = buildItinerary(p,s);
  assert.ok(r.shortVisit);
  assert.ok(r.shortVisit.end <= Date.parse('2026-11-28T18:30+03:00'));
  assert.equal(r.fixed[0].start,Date.parse('2026-11-28T19:00+03:00'));
  s.replan.at = '2026-11-28T18:25';
  assert.equal(buildItinerary(p,s).shortVisit,null);
  s.replan.at = '2026-11-28T18:00'; s.bookings = []; s.selected = ['cathedral'];
  assert.notEqual(buildItinerary(p,s).shortVisit?.id,'cathedral');
});
test('событие поиска на устройстве, обычная ссылка публична, удаление брони переживает перезагрузку', () => {
  const map = new Map(); globalThis.localStorage = {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  const privatePlan = {...p,event};
  assert.deepEqual(new URL(localTripPath(privatePlan),'https://x.ru').hash,new URL(tripPath(p),'https://x.ru').hash);
  assert.deepEqual(localTripEvent(p),event);
  const s = restoreItinerary(privatePlan);
  assert.equal(s.bookings.length,1); assert.equal(s.beforeFlight,175);
  assert.equal(restoreItinerary(privatePlan,{...s,bookings:[]}).bookings.length,0);
  assert.equal(decodeTrip(new URL(tripPath(privatePlan),'https://x.ru').hash).event,undefined);
});
test('снимок берёт время прилёта из последнего участка с исходным смещением и возвращается к длительности при неполных данных', () => {
  const arrived = '2026-11-27T20:18:00+03:00';
  const flight = snapshot({...offer,outbound_segments:[{arrival_at:arrived}]});
  assert.equal(flight.arrive,arrived);
  assert.equal(flight.arrivalSource,'segment');
  assert.deepEqual(decodeTrip(new URL(tripPath(flight),'https://x.ru').hash),flight);
  assert.equal(snapshot({...offer,outbound_segments:[{arrival_at:'bad'}]}).arrive,p.arrive);
});
