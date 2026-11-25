import { CLOUD } from './art.js';

const PERIODS = [[22, 'night'], [17, 'evening'], [10, 'day'], [5, 'morning']];
export const skyPeriod = (hour) => PERIODS.find(([from]) => hour >= from)?.[1] ?? 'night';

// Облака: ширина, высота на экране, прозрачность, время полёта, сдвиг по фазе и место, если движения нет.
const CLOUDS = [[220, 7, .8, 240, -30, 8], [140, 24, .6, 180, -120, 62], [260, 46, .5, 300, -200, 30], [170, 68, .55, 210, -60, 74], [120, 84, .45, 160, -140, 14]];

export function mountSky() {
  if (document.querySelector('.sky')) return;
  const sky = document.createElement('div');
  sky.className = 'sky';
  sky.setAttribute('aria-hidden', 'true');
  for (const [width, top, opacity, time, delay, x] of CLOUDS) {
    const item = document.createElement('div');
    item.className = 'sky-cloud';
    item.innerHTML = CLOUD;
    item.style.top = `${top}vh`;
    for (const [name, value] of [['--w', `${width}px`], ['--o', opacity], ['--t', `${time}s`], ['--d', `${delay}s`], ['--x', `${x}vw`]]) item.style.setProperty(name, value);
    sky.append(item);
  }
  document.body.prepend(sky);
  const update = () => { document.documentElement.dataset.sky = skyPeriod(new Date().getHours()); };
  update();
  setInterval(update, 5 * 60000);
}
