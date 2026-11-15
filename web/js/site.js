// Текстовые страницы: Метрика с согласием, блок «Кто мы», источники фото, оператор на странице конфиденциальности.
import './lib/measure.js';
import { esc } from './lib/ui.js';

const config = window.AVIATOR ?? {};
const safeLink = (value) => /^(https:\/\/|mailto:)/.test(value ?? '') ? value : null;
const team = config.team ?? [];

const teamBlock = document.getElementById('team');
if (teamBlock && (team.length || safeLink(config.contact))) {
  teamBlock.hidden = false;
  teamBlock.innerHTML = '<h2>Кто мы</h2>'
    + (team.length ? `<ul>${team.map((person) => `<li><b>${esc(person.name)}</b>${person.role ? ' — ' + esc(person.role) : ''}${safeLink(person.link) ? ` · <a href="${esc(person.link)}" rel="noopener">написать</a>` : ''}</li>`).join('')}</ul>` : '')
    + (safeLink(config.contact) ? `<p><a class="btn-inline" href="${esc(config.contact)}" rel="noopener">Связаться с нами</a></p>` : '');
}

// Оператор и контакт на странице «Конфиденциальность»: показываются, только если заполнены в config.js.
const operator = document.getElementById('operator');
if (operator) {
  const name = config.operator?.name, email = /^[^@\s]+@[^@\s]+$/.test(config.operator?.email ?? '') ? config.operator.email : null;
  if (name || email) {
    operator.hidden = false;
    operator.querySelector('[data-fill]').innerHTML = [name && esc(name), email && `<a href="mailto:${esc(email)}">${esc(email)}</a>`].filter(Boolean).join(' · ');
  }
}

// Источники фото — из файла приложения (его копирует scripts/build_web_assets.py).
const credits = document.getElementById('credits');
if (credits) {
  const inline = (text) => esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  fetch('/photos/credits.md', { cache: 'no-cache' }).then((response) => response.ok ? response.text() : Promise.reject()).then((markdown) => {
    let html = '', list = false;
    for (const line of markdown.split('\n').map((value) => value.trim()).filter(Boolean)) {
      const item = line.startsWith('- ');
      if (item !== list) { html += item ? '<ul class="credits">' : '</ul>'; list = item; }
      if (item) html += `<li>${inline(line.slice(2))}</li>`;
      else if (line.startsWith('## ')) html += `<h2>${inline(line.slice(3))}</h2>`;
      else if (!line.startsWith('# ')) html += `<p>${inline(line)}</p>`;
    }
    credits.innerHTML = html + (list ? '</ul>' : '');
  }).catch(() => { credits.innerHTML = '<p>Не удалось загрузить список источников. Обновите страницу.</p>'; });
}
