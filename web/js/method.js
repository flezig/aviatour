const main = document.querySelector('.method');
const topics = [...main.querySelectorAll('.method-topic')];
const chapters = main.querySelector('.method-chapters');
const outline = main.querySelector('.method-outline');
const menu = main.querySelector('dialog');
const openButton = document.getElementById('method-open');
let currentTopic;
let linkedQuestion;
let frame;

function link(target, label, className) {
  const anchor = document.createElement('a');
  anchor.href = '#' + target.id;
  anchor.textContent = label;
  anchor.className = className;
  return anchor;
}

function highlightQuestion() {
  const sections = [...currentTopic.querySelectorAll('section')];
  const visible = sections.filter(section => section.getBoundingClientRect().top <= 90);
  const atEnd = window.scrollY > 0 && Math.ceil(window.scrollY + innerHeight) >= document.documentElement.scrollHeight - 1;
  const selected = linkedQuestion || (atEnd ? sections.at(-1) : visible.at(-1) || sections[0]);
  for (const item of main.querySelectorAll('a.question')) {
    if (item.hash === '#' + selected.id) item.setAttribute('aria-current', 'location');
    else item.removeAttribute('aria-current');
  }
}

function showTopic() {
  const target = document.getElementById(location.hash.slice(1));
  currentTopic = target?.closest('.method-topic') || document.getElementById('prices');
  for (const article of topics) article.hidden = article !== currentTopic;
  const sections = [...currentTopic.querySelectorAll('section')];
  const questions = sections.map(section => link(section, section.querySelector('h3').textContent, 'question'));
  outline.querySelector('div').replaceChildren(...questions);
  outline.hidden = sections.length < 3;
  const mobileLinks = [];
  for (const entry of chapters.querySelectorAll('a')) {
    const active = entry.hash === '#' + currentTopic.id;
    if (active) entry.setAttribute('aria-current', 'page');
    else entry.removeAttribute('aria-current');
    mobileLinks.push(entry.cloneNode(true));
    if (active) mobileLinks.push(...questions.map(question => question.cloneNode(true)));
  }
  menu.querySelector('nav').replaceChildren(...mobileLinks);
  linkedQuestion = target?.matches('section') ? target : null;
  if (linkedQuestion) linkedQuestion.scrollIntoView();
  else window.scrollTo(0, 0);
  highlightQuestion();
}

openButton.hidden = false;
main.classList.add('is-enhanced');
openButton.addEventListener('click', () => menu.showModal());
menu.addEventListener('click', event => {
  const anchor = event.target.closest('a');
  if (!anchor) return;
  menu.close();
  if (anchor.hash === location.hash) showTopic();
});
window.addEventListener('hashchange', showTopic);
for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) {
  window.addEventListener(event, () => { linkedQuestion = null; }, { passive: true });
}
window.addEventListener('scroll', () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(highlightQuestion);
}, { passive: true });
showTopic();
