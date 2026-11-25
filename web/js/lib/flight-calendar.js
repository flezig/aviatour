import { addDays, monthLabel, fmtMoney, zoned } from './format.js';

const byId = id => document.getElementById(id);
const utc = key => new Date(key + 'T00:00:00Z');
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short', timeZone:'UTC' });
export const shortDay = key => dayFormat.format(utc(key)).replace(/\.$/, '');
function nextMonth(month, offset) {
  const date = utc(month + '-01');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
export function openCalendar(trigger, query, months, today, apply, loadFares) {
  const dialog = byId('flightCalendar'), body = byId('calBody');
  const mobile = matchMedia('(max-width: 699px)');
  let month = query.month, weekend = query.weekend;
  let start = query.departure || '', end = query.returning || '';
  let step = trigger.dataset.field === 'returning' && start ? 'end' : 'start';
  let mode = 'exact', view = (step === 'end' ? end : start).slice(0,7) || query.month;
  if (!mobile.matches && step==='end' && start && nextMonth(start.slice(0,7),1) === view) view=start.slice(0,7);
  const lastOut = addDays(nextMonth(months.at(-1),1) + '-01',-1);
  const controller = new AbortController();
  const monthly = new Map();
  let cheaperDay = '';
  const compact = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  function faresForStart() {
    if (mode !== 'exact' || step !== 'end' || !start || !query.destination) return null;
    const key = start.slice(0, 7);
    if (!monthly.has(key)) {
      const entry = { status: 'loading', dates: new Map() };
      monthly.set(key, entry);
      loadFares(key, controller.signal).then(data => {
        if (!Array.isArray(data.offers)) throw new Error('calendar response');
        for (const offer of data.offers) {
          if (offer.source !== 'LIVE' || offer.currency !== 'RUB' || !(offer.price_minor > 0)) continue;
          const out = zoned(new Date(offer.departure_at), offer.origin_timezone).key;
          const back = zoned(new Date(offer.return_at), offer.destination_timezone).key;
          if (!entry.dates.has(out)) entry.dates.set(out, new Map());
          const prices = entry.dates.get(out);
          prices.set(back, Math.min(prices.get(back) ?? Infinity, offer.price_minor));
        }
        entry.status = 'ready';
        entry.observed = data.received_at;
      }).catch(() => { entry.status = 'error'; }).finally(() => {
        if (!controller.signal.aborted && dialog.open) {
          const active = document.activeElement.dataset;
          render(active.day ? '[data-day="' + active.day + '"]' : null);
        }
      });
    }
    return monthly.get(key);
  }
  function bounds() {
    return step === 'end' && start ? [addDays(start,1),addDays(start,60)] : [today,lastOut];
  }
  function position() {
    if (!dialog.open || mobile.matches) return;
    const r = trigger.getBoundingClientRect();
    dialog.style.left = Math.max(8,Math.min(r.left - 40,innerWidth-dialog.offsetWidth-8))+'px';
    dialog.style.top = Math.max(8,Math.min(r.bottom+9,innerHeight-dialog.offsetHeight-8))+'px';
  }
  function grid(m, lo, hi, prices, minimum) {
    const first = utc(m+'-01'), count = utc(addDays(nextMonth(m,1)+'-01',-1)).getUTCDate();
    let days = '<i></i>'.repeat((first.getUTCDay()+6)%7);
    for (let i=1; i<=count; i++) {
      const key = m+'-'+String(i).padStart(2,'0');
      const cls = key===start || key===end ? 'edge' : key>start && key<end ? 'between' : '';
      const price = key >= lo && key <= hi && prices?.get(key);
      const amount = price ? '<small>' + compact.format(price / 100000) + '</small>' : '';
      days += '<button type="button" data-day="'+key+'" class="'+cls+(price && price === minimum ? ' lowest' : '')+'" aria-label="'+shortDay(key)+(price ? ', '+fmtMoney(price) : '')+'" '+(key<lo||key>hi?'disabled':'')+'><span>'+i+'</span>'+amount+'</button>';
    }
    return '<section><h3>'+monthLabel(m)+'</h3><div class="week">'+['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="days">'+days+'</div></section>';
  }
  function render(focus) {
    const [lo,hi]=bounds(), two=!mobile.matches;
    const minView=step==='end' && start ? start.slice(0,7) : lo.slice(0,7), maxView=nextMonth(hi.slice(0,7),two && minView!==hi.slice(0,7)?-1:0);
    view=view<minView?minView:view>maxView?maxView:view;
    const entry = faresForStart();
    const prices = entry?.dates.get(start);
    const lastVisible = two ? nextMonth(view, 1) : view;
    const visible = [...(prices || [])].filter(([key]) =>
      key >= lo && key <= hi && key.slice(0, 7) >= view && key.slice(0, 7) <= lastVisible
    ).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    const best = visible[0];
    const selected = prices?.get(end);
    byId('calChangeStart').hidden = mode !== 'exact' || step !== 'end';
    const legend = byId('calLegend');
    legend.textContent = mode !== 'exact' ? '' : !query.destination ? 'Выберите направление, чтобы увидеть цены.' :
      step !== 'end' ? 'Выберите вылет, чтобы сравнить даты возврата.' :
      entry?.status === 'loading' ? 'Загружаем цены…' : entry?.status === 'error' ? 'Не удалось загрузить цены.' :
      !best ? 'На эти даты пока нет цен.' : 'Туда-обратно за взрослого, тыс. ₽' +
        (entry.observed ? ', данные за ' + shortDay(entry.observed.slice(0, 10)) : '');
    legend.hidden = !legend.textContent;
    cheaperDay = best && selected > best[1] ? best[0] : '';
    byId('calCheaper').hidden = !cheaperDay;
    if (cheaperDay) byId('calCheaper').textContent = 'Вернуться ' + shortDay(cheaperDay) + ' — на ' + fmtMoney(selected - best[1]) + ' дешевле';
    dialog.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
    if (mode==='month') {
      body.innerHTML='<div class="month-options">'+months.map(m=>'<button data-month="'+m+'" aria-pressed="'+(m===month)+'">'+monthLabel(m)+'</button>').join('')+'</div><label class="weekend-opt"><input type="checkbox" id="calWeekend" '+(weekend?'checked':'')+'> Только на выходные</label>';
    } else {
      body.innerHTML='<div class="cal-grid">'+grid(view,lo,hi,prices,best?.[1])+(two?grid(nextMonth(view,1),lo,hi,prices,best?.[1]):'')+'</div><button class="cal-prev" data-shift="-1" aria-label="Предыдущий месяц" '+(view<=minView?'disabled':'')+'>‹</button><button class="cal-next" data-shift="1" aria-label="Следующий месяц" '+(view>=maxView?'disabled':'')+'>›</button>';
    }
    byId('calStatus').textContent=mode==='month'?monthLabel(month):start && end?shortDay(start)+' — '+shortDay(end)+(selected ? ', '+fmtMoney(selected) : ''):start?'С '+shortDay(start)+', выберите возврат':'Выберите вылет';
    byId('calApply').disabled=mode==='exact' && !(start && end);
    position();
    if(focus) (body.querySelector(focus+':not(:disabled)') || body.querySelector('button:not(:disabled)'))?.focus({preventScroll:true});
  }
  const resize=()=>render();
  trigger.setAttribute('aria-expanded','true');
  dialog.onclose=()=>{controller.abort();trigger.setAttribute('aria-expanded','false');window.removeEventListener('resize',resize);window.removeEventListener('scroll',position);};
  dialog.onchange=e=>{if(e.target.id==='calWeekend')weekend=e.target.checked;};
  dialog.onclick=e=>{
    const b=e.target.closest('button');
    if(!b)return;
    if(b.dataset.mode){mode=b.dataset.mode;render();}
    if(b.dataset.shift){view=nextMonth(view,Number(b.dataset.shift));render('[data-shift="'+b.dataset.shift+'"]');}
    if(b.dataset.month){month=b.dataset.month;render('[data-month="'+month+'"]');}
    if(b.dataset.day){
      const key=b.dataset.day;
      if(step==='start'){start=key;end='';step='end';}else{end=key;}
      render('[data-day="'+key+'"]');
    }
    if(b.id==='calChangeStart'){step='start';view=start.slice(0,7);render('[data-day="'+start+'"]');}
    if(b.id==='calCheaper' && cheaperDay){end=cheaperDay;render('[data-day="'+end+'"]');}
    if(b.id==='calApply'){
      apply(mode==='month'?{exact:false,month,weekend}:{exact:true,departure:start,returning:end});
      dialog.close();
    }
  };
  render(); dialog.showModal(); position();
  window.addEventListener('resize',resize);window.addEventListener('scroll',position,{passive:true});
}
