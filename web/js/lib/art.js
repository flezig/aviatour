// Своя графика сайта: облако и самолёт для фона страницы.
// Векторная, без файлов и чужих библиотек; цвета — из дизайн-системы (docs/design-system.md).

// Облако из кругов: цвет — currentColor (в CSS — --cloud).
const cloud = (x, y, scale) => `<g transform="translate(${x} ${y}) scale(${scale})"><circle cx="30" cy="36" r="13"/><circle cx="52" cy="25" r="19"/><circle cx="77" cy="29" r="15"/><circle cx="96" cy="38" r="11"/><rect x="16" y="36" width="92" height="16" rx="8"/></g>`;
export const CLOUD = `<svg viewBox="0 0 120 56" aria-hidden="true"><g fill="currentColor">${cloud(0, 0, 1)}</g></svg>`;

// Самолёт сверху (как в значке), носом вправо — для неба за страницей.
export const PLANE_TOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path transform="rotate(45 12 12)" fill="currentColor" d="M21.5 3.2c-.9-.9-2.4-.7-3.4.3l-3.5 3.5-9.3-2.6-1.6 1.6 7.5 4.4-3.6 3.6-2.6-.5-1.3 1.3 3.5 1.9 1.9 3.5 1.3-1.3-.5-2.6 3.6-3.6 4.4 7.5 1.6-1.6-2.6-9.3 3.5-3.5c1-1 1.2-2.5.3-3.4z"/></svg>';
