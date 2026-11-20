// Same five entrances, in the same order, as KZN.places in city_rating_routes.json.
// Outdoor walks cover the stated street or square. Indoor visits use published opening hours.
export const checkedOn = '2026-11-20';
export const places = [
  { id: 'kremlin', title: 'Казанский кремль', address: 'Площадь 1 Мая, вход через Спасскую башню',
    minutes: 45, open: 0, close: 1440, note: 'Прогулка по территории. Вход через Спасскую башню круглосуточный.',
    url: 'https://www.kazan-kremlin.ru/rezhim-raboty' },
  { id: 'cat', title: 'Кот Казанский на Баумана', address: 'Пересечение улиц Баумана и Мусы Джалиля',
    minutes: 20, open: 0, close: 1440, note: 'Прогулка по пешеходной улице.',
    url: 'https://go.kzn.ru/articles/ot-saliapina-do-kota-kazanskogo-znakovye-mesta-ulicy-baumana' },
  { id: 'cathedral', title: 'Петропавловский собор', address: 'Ул. Мусы Джалиля, 21',
    minutes: 30, open: 540, close: 1080, note: 'Открыт ежедневно с 09:00 до 18:00. Перед визитом уточните время службы.',
    url: 'https://go.kzn.ru/places/petropavlovskii-sobor' },
  { id: 'freedom', title: 'Площадь Свободы', address: 'Площадь Свободы, ул. Карла Маркса',
    minutes: 25, open: 0, close: 1440, note: 'Прогулка по площади.',
    url: 'https://go.kzn.ru/places/ploshhad-svobody' },
  { id: 'marjani', title: 'Мечеть Аль-Марджани', address: 'Ул. Каюма Насыри, 17',
    minutes: 30, open: 0, close: 1440, note: 'Осмотр с улицы. Время посещения внутри уточните в мечети.',
    url: 'https://go.kzn.ru/places/mecet-al-mardzani' },
];
export const placeById = new Map(places.map(place => [place.id, place]));
export const walkSource = 'https://routing.openstreetmap.de/routed-foot/table/v1/foot/49.1080371,55.7965753;49.1123314,55.7921706;49.1131348,55.793525;49.1251354,55.7968576;49.1180451,55.7797549?annotations=duration,distance&generate_hints=false';
// OSRM walking durations in seconds. Round up each leg to the next whole minute.
const seconds = [
  [0, 581.7, 573.4, 1021.3, 1976.8],
  [581.7, 0, 296, 1043.3, 1434.8],
  [573.4, 296, 0, 943.9, 1733],
  [1021.3, 1043.3, 943.9, 0, 1838.2],
  [1976.8, 1434.8, 1733, 1838.2, 0],
];
export function walkMinutes(from, to) {
  return Math.ceil(seconds[places.findIndex(p => p.id === from)][places.findIndex(p => p.id === to)] / 60);
}
