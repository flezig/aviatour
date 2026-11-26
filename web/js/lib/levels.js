// Уровень цены и подписи подборок. Правило то же, что на сервере (backend/app/showcase.py): обычная цена — медиана
// самых низких цен по парам дат в тот же город, в том же месяце, для той же длины поездки; ±15 % — «обычная цена».
import { plural } from './format.js';

export const LEVEL_BAND = 15;
export const LENGTH_GROUPS = ['1–2 ночи', '3–4 ночи', '5–7 ночей', '8–14 ночей'];
export const lengthGroup = (nights) => nights <= 2 ? 0 : nights <= 4 ? 1 : nights <= 7 ? 2 : 3;
export const usualKey = (city, month, nights) => `${city}|${month}|${lengthGroup(nights)}`;
export const LEVEL_WORDS = { low: 'ниже обычной', usual: 'обычная цена', high: 'выше обычной' };

export function priceLevel(price, usual) {
  const diff = Math.round((price / usual - 1) * 100);
  return { kind: diff <= -LEVEL_BAND ? 'low' : diff >= LEVEL_BAND ? 'high' : 'usual', diff };
}

const IN_MONTH = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
export const inMonth = (month) => IN_MONTH[Number(month.slice(5, 7)) - 1];
const days = (count) => `${count} ${plural(count, 'день', 'дня', 'дней')}`;
export const daysAhead = (count) => count === 0 ? 'сегодня' : count === 1 ? 'завтра' : `через ${days(count)}`;

// «вылет через 3 дня, на 30% ниже обычной цены в декабре»
export const hotLine = (ahead, diff, month) => `вылет ${daysAhead(ahead)}, на ${Math.abs(diff)}% ниже обычной цены в ${inMonth(month)}`;
// «2 дня отпуска — 6 дней поездки» или «3 дня поездки». Дней поездки = ночей + 1, в подборках ночей не больше 7 — значит, до 8 дней.
export const leaveLine = (leave, tripDays) => leave ? `${days(leave)} отпуска — ${days(tripDays)} поездки` : `${days(tripDays)} поездки`;

// Объяснение по нажатию на уровень цены.
export function levelNote({ diff, usualText, pairs, month, nights }) {
  const base = `Обычная цена ≈ ${usualText} — середина самых низких цен Aviasales на разные даты в ${inMonth(month)} для поездок на ${LENGTH_GROUPS[lengthGroup(nights)]} (${pairs} ${plural(pairs, 'пара', 'пары', 'пар')} дат).`;
  return `${base} ${diff ? `Эта на ${Math.abs(diff)}% ${diff < 0 ? 'ниже' : 'выше'}.` : 'Эта — такая же.'}`;
}

// «Продолжить планирование»: та же поездка подешевела, подорожала или стоит столько же.
export function priceChange(before, now) {
  if (!Number.isFinite(before) || !Number.isFinite(now)) return null;
  return { kind: now < before ? 'down' : now > before ? 'up' : 'same', amount: Math.abs(now - before) };
}
