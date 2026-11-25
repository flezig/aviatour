import { plural } from './format.js';

export const oneAdult = () => ({ adults: 1, ages: [] });
export const groupSize = p => p.adults + p.ages.length;
export const infants = p => p.ages.filter(age => Number.isInteger(age) && age < 2).length;

export function validPassengers(p) {
  return Number.isInteger(p?.adults) && p.adults >= 1 && Array.isArray(p.ages)
    && groupSize(p) <= 9 && p.ages.every(age => Number.isInteger(age) && age >= 0 && age <= 11)
    && infants(p) <= p.adults;
}

export function passengersFromParams(params) {
  const adults = params.get('adults') ?? '1', ages = params.get('ages');
  if (!/^[1-9]$/.test(adults) || (ages !== null && !/^(?:[0-9]|1[01])(?:,(?:[0-9]|1[01])){0,7}$/.test(ages))) return oneAdult();
  const party = { adults: Number(adults), ages: ages === null ? [] : ages.split(',').map(Number) };
  return validPassengers(party) ? party : oneAdult();
}

export function setPassengerParams(params, p) {
  if (p.adults > 1) params.set('adults', p.adults); else params.delete('adults');
  if (p.ages.length) params.set('ages', p.ages.join(',')); else params.delete('ages');
}

export function passengerLabel(p) {
  const adults = p.adults + ' ' + plural(p.adults, 'взрослый', 'взрослых', 'взрослых');
  if (!p.ages.length) return adults;
  const children = p.ages.length + ' ' + plural(p.ages.length, 'ребёнок', 'ребёнка', 'детей');
  const ages = p.ages.map(age => age ? age + ' ' + plural(age, 'год', 'года', 'лет') : 'до года');
  return adults + ', ' + children + ' (' + ages.join(', ') + ')';
}

export function ticketAction(p) {
  const group = ['', '', 'двоих', 'троих', 'четверых', 'пятерых', 'шестерых', 'семерых', 'восьмерых', 'девятерых'];
  return groupSize(p) === 1 ? 'Проверить цену на Aviasales' : 'Проверить цену на ' + group[groupSize(p)];
}
