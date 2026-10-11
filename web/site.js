'use strict';
// Общие блоки текстовых страниц. Настройки — в config.js.
const SITE = window.AVIATOR ?? { team: [], contact: '' };

(() => {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeLink = (value) => /^(https:\/\/|mailto:)/.test(value ?? '') ? value : null;

  const team = document.getElementById('team');
  if (team && (SITE.team.length || safeLink(SITE.contact))) {
    team.hidden = false;
    team.innerHTML = '<h2>Кто мы</h2>'
      + (SITE.team.length ? `<ul>${SITE.team.map((person) => `<li><b>${esc(person.name)}</b>${person.role ? ' — ' + esc(person.role) : ''}${safeLink(person.link) ? ` · <a href="${esc(person.link)}" rel="noopener">написать</a>` : ''}</li>`).join('')}</ul>` : '')
      + (safeLink(SITE.contact) ? `<p><a class="btn-inline" href="${esc(SITE.contact)}" rel="noopener">Связаться с нами</a></p>` : '');
  }

  // Photo attribution is rendered from the app's own credits file (copied by scripts/build_web_assets.py).
  const credits = document.getElementById('credits');
  if (credits) {
    const inline = (text) => esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\((https:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    fetch('photos/credits.md').then((response) => response.ok ? response.text() : Promise.reject()).then((markdown) => {
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
})();
