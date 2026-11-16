// Наклейки у названий подборок (вариант A, выбор владельца 16.11.2026): цветной значок, слегка повёрнут.
// Белая вырубка — только у календаря и моря (владельцу она нравится только у них). Свой вектор, цвета — палитра сайта.
const SUN = '#f5b301';
const SHAPES = {
  hot: { colors: ['#e8243c', '#ffd1d6', '#a3122a'], parts: [
    ['M12 2.5c1.2 3.6-1.6 5.2-1.6 7.8 0 1.4 1 2.6 2.5 2.6 1.7 0 2.7-1.4 2.4-3.6 2.4 1.6 3.9 4.2 3.9 6.8 0 3.8-3.2 6.4-7.2 6.4S4.8 19.9 4.8 16.1c0-5 4.6-7.2 7.2-13.6z', 'main'],
    ['M12 21.3c-1.9 0-3.2-1.3-3.2-3 0-2.1 1.9-3.1 3.1-5 .9 1.5 3.3 2.7 3.3 5 0 1.7-1.3 3-3.2 3z', 'light']] },
  weekend: { outline: true, colors: ['#2346d8', '#ffffff', '#0f1b3d'], parts: [
    ['M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v12.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5V7a1.5 1.5 0 0 1 1.5-1.5z', 'main'],
    ['M3 9.5h18v-2.5a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 7z', 'dark'], ['M7.5 3v4M16.5 3v4', 'line'], ['M7 13h3v3H7zM14 13h3v3h-3z', 'light']] },
  holidays: { colors: ['#17703a', '#ffffff', '#0e4a26'], parts: [
    ['M12 2 16.5 8h-2.3l4.6 6h-2.6l4.8 6.5H3l4.8-6.5H5.2l4.6-6H7.5z', 'main'], ['M10.6 20.5h2.8V23h-2.8z', 'dark'], ['M9.5 12.5h.01M14 15.5h.01M11 17h.01', 'dots']] },
  budget: { colors: ['#0f1b3d', '#ffffff', '#2346d8'], parts: [
    ['M3.5 7.5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', 'main'], ['M4 7.5 15.5 3.6a1.5 1.5 0 0 1 1.9 1l.8 2.9', 'ink'],
    ['M15 12h5.5v4H15a2 2 0 0 1 0-4z', 'dark'], ['M15.8 14h.01', 'dots']] },
  sea: { outline: true, colors: ['#2f80ed', '#ffffff', '#1b4fa8'], parts: [
    ['M18 2.8a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2z', 'accent'],
    ['M1.5 14.5c2.3 0 2.3-1.8 4.6-1.8s2.3 1.8 4.6 1.8 2.3-1.8 4.6-1.8 2.3 1.8 4.6 1.8 2.6-1 2.6-1V22H1.5z', 'main'],
    ['M3 18.5c1.8 0 1.8-1.3 3.6-1.3s1.8 1.3 3.6 1.3 1.8-1.3 3.6-1.3 1.8 1.3 3.6 1.3', 'line']] },
  mountains: { colors: ['#3c4a6b', '#ffffff', '#24304d'], parts: [
    ['M1.5 21 9 7.5l4.4 7.3 2.9-4.3L22.5 21z', 'main'], ['M9 7.5l2.4 4-1.3-.6-1.1 1.1-1.1-1.1-1.3.7z', 'light'], ['M16.3 10.5l1.7 2.5-.9-.4-.8.8-.8-.8-.9.4z', 'light']] },
  food: { colors: ['#b8325a', '#ffd9e3', '#7d1a3a'], parts: [
    ['M2.8 11.5h18.4a9.2 9.2 0 0 1-18.4 0z', 'main'], ['M5 13.8c1.8 2.9 4.2 4.3 7 4.3', 'lightline'], ['M8 3.5c-1 1.3 1 2.2 0 3.6M12 2.8c-1 1.4 1 2.4 0 3.9M16 3.5c-1 1.3 1 2.2 0 3.6', 'steam']] },
  city2: { colors: [SUN, '#ffffff', '#8a6400'], parts: [
    ['M4 8h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', 'main'], ['M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8', 'darkline'],
    ['M7.5 8v13M16.5 8v13', 'darkline']] },
  recent: { colors: ['#0f1b3d', '#ffffff', '#2346d8'], parts: [
    ['M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19z', 'main'], ['M12 7v5.2l3.4 2.1', 'line'], ['M12 12.2h.01', 'dots']] },
};

export function sticker(key) {
  const shape = SHAPES[key] ?? SHAPES.weekend;
  const [main, light, dark] = shape.colors;
  const paint = ([d, role]) => {
    if (role === 'line') return `<path d="${d}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`;
    if (role === 'lightline') return `<path d="${d}" fill="none" stroke="${light}" stroke-width="1.5" stroke-linecap="round" opacity=".7"/>`;
    if (role === 'ink' || role === 'darkline') return `<path d="${d}" fill="none" stroke="${dark}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (role === 'steam') return `<path d="${d}" fill="none" stroke="#8b93a7" stroke-width="1.5" stroke-linecap="round"/>`;
    if (role === 'dots') return `<path d="${d}" fill="none" stroke="${light}" stroke-width="2.6" stroke-linecap="round"/>`;
    return `<path d="${d}" fill="${{ main, light, dark, accent: SUN }[role]}"/>`;
  };
  // Вырубка — тот же контур белым и толще, под рисунком; только у календаря и моря.
  const outline = shape.outline ? shape.parts.map(([d]) => `<path d="${d}" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`).join('') : '';
  return `<svg class="sticker${shape.outline ? ' sticker--cut' : ''}" viewBox="-3 -3 30 30" aria-hidden="true">${outline}${shape.parts.map(paint).join('')}</svg>`;
}

// Какая наклейка у подборки главной.
export function rowSticker(row) {
  if (row.key.startsWith('weekend')) return 'weekend';
  if (row.key.startsWith('budget')) return 'budget';
  if (row.key === 'holidays') return row.title === 'Новогодние каникулы' ? 'holidays' : 'weekend';
  return SHAPES[row.key] ? row.key : 'weekend';
}
