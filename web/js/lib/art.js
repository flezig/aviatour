// Своя графика сайта: облако, самолёт сбоку и сцена загрузки «самолёт летит сквозь облака».
// Векторная, без файлов и чужих библиотек; цвета — из дизайн-системы (docs/design-system.md).

// Облако из кругов: цвет — currentColor (в CSS — --cloud).
const cloud = (x, y, scale) => `<g transform="translate(${x} ${y}) scale(${scale})"><circle cx="30" cy="36" r="13"/><circle cx="52" cy="25" r="19"/><circle cx="77" cy="29" r="15"/><circle cx="96" cy="38" r="11"/><rect x="16" y="36" width="92" height="16" rx="8"/></g>`;
export const CLOUD = `<svg viewBox="0 0 120 56" aria-hidden="true"><g fill="currentColor">${cloud(0, 0, 1)}</g></svg>`;

// Самолёт сверху (как в значке), носом вправо — для неба за страницей.
export const PLANE_TOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path transform="rotate(45 12 12)" fill="currentColor" d="M21.5 3.2c-.9-.9-2.4-.7-3.4.3l-3.5 3.5-9.3-2.6-1.6 1.6 7.5 4.4-3.6 3.6-2.6-.5-1.3 1.3 3.5 1.9 1.9 3.5 1.3-1.3-.5-2.6 3.6-3.6 4.4 7.5 1.6-1.6-2.6-9.3 3.5-3.5c1-1 1.2-2.5.3-3.4z"/></svg>';

// Самолёт сбоку, носом вправо: белый фюзеляж, кобальтовые киль и полоса.
const WINDOWS = Array.from({ length: 13 }, (_, i) => `<circle cx="${(31 + i * 5.6).toFixed(1)}" cy="20.4" r="1.15"/>`).join('');
export const AIRLINER = `<svg viewBox="0 0 132 46" aria-hidden="true">
  <path d="M70 18 L56 5.5 Q55 4.5 56.6 4.5 L60.4 4.5 Q62.2 4.5 63.6 5.6 L83 18.4 Z" fill="#b8c8ee"/>
  <path d="M14 19.2 L6.2 3 Q5.4 1.2 7.6 1.2 L12.2 1.2 Q14.2 1.2 15.6 3 L31 18.6 Z" fill="#2346d8"/>
  <path d="M10 18.6 C30 16.6 86 15.6 104 16 C118 16.4 128.5 19.8 128.5 23.4 C128.5 27 119 29.6 104 30 L22 30 C13 30 7 27.2 7 23.2 C7 20.8 8 19.2 10 18.6 Z" fill="#fff"/>
  <path d="M14 27.4 C40 28.6 92 28.6 121 26.6 C117 29 111 29.9 104 30 L22 30 C17.4 30 14.6 29 14 27.4 Z" fill="#dde5f6"/>
  <path d="M17 23.4 L113 22.4 L113 23.9 L17 24.9 Z" fill="#2346d8"/>
  <g fill="#0f1b3d" opacity=".5">${WINDOWS}</g>
  <path d="M112.6 18.5 Q118.4 18.6 121.8 20.8 L114 21.2 Z" fill="#0f1b3d" opacity=".72"/>
  <path d="M12 25.2 L2.6 31.6 Q1.2 32.8 3.2 32.8 L9.4 32.8 Q11.4 32.8 12.8 31.6 L24.4 26 Z" fill="#2346d8"/>
  <path d="M66 26.2 L46 41.6 Q44.2 43.2 46.8 43.2 L51.4 43.2 Q53.4 43.2 55 41.8 L82.4 26.6 Z" fill="#c7d4f1"/>
  <rect x="62" y="29.6" width="17" height="6.4" rx="3.2" fill="#fff" stroke="#c7d4f1" stroke-width=".9"/>
  <rect x="75.6" y="30.5" width="3.2" height="4.6" rx="1.3" fill="#2346d8"/>
</svg>`;

const FAR = `<svg viewBox="0 0 560 70" aria-hidden="true"><g fill="currentColor">${cloud(18, 4, .55)}${cloud(150, 18, .4)}${cloud(268, 0, .62)}${cloud(420, 14, .48)}</g></svg>`;
const NEAR = `<svg viewBox="0 0 560 120" aria-hidden="true"><g fill="currentColor">${cloud(60, 10, 1.25)}${cloud(330, 30, 1.05)}</g></svg>`;

// Сцена загрузки: дальние облака медленно, ближние быстро и перед самолётом — он «пролетает сквозь» них.
export function flightLoader(text) {
  return `<div class="flyby" role="status"><div class="flyby-scene" aria-hidden="true">
    <div class="flyby-clouds flyby-clouds--far">${FAR}${FAR}</div>
    <div class="flyby-plane"><span class="flyby-trail"></span><span class="flyby-trail"></span>${AIRLINER}</div>
    <div class="flyby-clouds flyby-clouds--near">${NEAR}${NEAR}</div>
  </div><p class="flyby-text">${text}</p></div>`;
}
