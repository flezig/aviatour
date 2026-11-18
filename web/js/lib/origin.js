// Город вылета посетителя. Выбор хранится в этом браузере (aviator.origin). Без выбора — подсказка сервера
// (/api/v1/origin: ближайший город по местоположению, которое определяет хостинг; иначе Москва). Геолокацию браузера не спрашиваем.
const KEY = 'aviator.origin';
const DAY = 86400000;
const code = (value) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);

export function validOrigin(value) {
  return Boolean(value && code(value.code) && code(value.iata) && typeof value.all === 'boolean' && typeof value.name === 'string' && value.name
    && (value.from == null || typeof value.from === 'string'));
}
export function storedOrigin() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return validOrigin(value) ? value : null;
  } catch { return null; }
}
// manual: посетитель выбрал сам — запоминаем без срока; подсказку сервера — на сутки.
export function saveOrigin(origin, manual) {
  if (!validOrigin(origin)) return;
  const { code: city, iata, all, name, from } = origin;
  try { localStorage.setItem(KEY, JSON.stringify({ code: city, iata, all, name, from: from ?? null, manual: Boolean(manual), at: Date.now() })); } catch { /* частный режим */ }
}
export async function currentOrigin() {
  const stored = storedOrigin();
  if (stored && (stored.manual || Date.now() - stored.at < DAY)) return stored;
  try {
    const response = await fetch('/api/v1/origin');
    const origin = response.ok ? await response.json() : null;
    const chosen = storedOrigin();
    if (chosen?.manual) return chosen;
    if (validOrigin(origin)) { saveOrigin(origin, false); return origin; }
  } catch { /* нет связи — остаётся прежний выбор */ }
  return stored;
}
