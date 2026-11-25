import { $, icon } from './ui.js';
import { groupSize, infants, validPassengers } from './passengers.js';
import { plural } from './format.js';

export function passengerPicker(onApply) {
  const dialog = $('passengerPicker'), compact = matchMedia('(max-width: 899px)');
  let draft, anchor;
  function position() {
    if (!dialog.open || compact.matches) return;
    const r = anchor.getBoundingClientRect(), gap = 8;
    const left = Math.min(Math.max(gap, r.left), innerWidth - dialog.offsetWidth - gap);
    const top = r.bottom + gap + dialog.offsetHeight <= innerHeight
      ? r.bottom + gap : Math.max(gap, Math.min(innerHeight - dialog.offsetHeight - gap, r.top - dialog.offsetHeight - gap));
    dialog.style.setProperty('--passenger-left', left + 'px');
    dialog.style.setProperty('--passenger-top', top + 'px');
  }
  function render() {
    const total = groupSize(draft), lap = infants(draft);
    $('passengerNote').hidden = !draft.ages.length;
    $('infantNote').hidden = !lap;
    $('adultCount').textContent = draft.adults;
    $('adultMinus').disabled = draft.adults <= Math.max(1, lap);
    $('adultPlus').disabled = total >= 9;
    $('addChild').disabled = total >= 9 || draft.ages.includes(null);
    $('applyPassengers').disabled = !validPassengers(draft);
    $('childRows').innerHTML = draft.ages.map((age, i) => {
      const options = Array.from({ length: 12 }, (_, years) => {
        const unavailable = years < 2 && lap - (age !== null && age < 2 ? 1 : 0) >= draft.adults;
        const label = years ? years + ' ' + plural(years, 'год', 'года', 'лет') : 'До года';
        return '<option value="' + years + '"' + (years === age ? ' selected' : '') + (unavailable ? ' disabled' : '') + '>' + label + '</option>';
      }).join('');
      return `<div class="passenger-row"><label for="childAge${i}">Ребёнок ${i + 1}</label>
        <select class="menu" id="childAge${i}" data-age="${i}" aria-label="Возраст ребёнка ${i + 1}"><option value="" disabled ${age === null ? 'selected' : ''}>Возраст</option>${options}</select>
        <button type="button" class="passenger-remove" data-remove="${i}" aria-label="Убрать ребёнка ${i + 1}">${icon('close')}</button></div>`;
    }).join('');
    position();
  }
  $('adultMinus').addEventListener('click', () => { draft.adults--; render(); });
  $('adultPlus').addEventListener('click', () => { draft.adults++; render(); });
  $('addChild').addEventListener('click', () => {
    draft.ages.push(null);
    render();
    $('childAge' + (draft.ages.length - 1)).focus();
  });
  $('childRows').addEventListener('change', event => {
    const select = event.target.closest('[data-age]');
    if (!select) return;
    draft.ages[Number(select.dataset.age)] = Number(select.value);
    render();
    $(select.id).focus();
  });
  $('childRows').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove]');
    if (!remove) return;
    draft.ages.splice(Number(remove.dataset.remove), 1);
    render();
    $('addChild').focus();
  });
  $('applyPassengers').addEventListener('click', () => {
    if (validPassengers(draft)) { onApply(draft); dialog.close(); }
  });
  addEventListener('resize', position);
  addEventListener('scroll', position, { passive: true });
  return (trigger, current) => {
    anchor = trigger;
    draft = { adults: current.adults, ages: [...current.ages] };
    render();
    dialog.showModal();
    position();
  };
}
