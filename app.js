/* Fuerza — strength sessions for a runner. Vanilla JS, offline-first PWA.
 * Data:   data/exercises.json, data/routines.json, data/plan.json (authored, deployed with the app)
 * Logs:   IndexedDB "fuerza" (store "logs"), current session + settings in store "kv".
 */
'use strict';

const VERSION = '0.1.0';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DAYS_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const FEELS = [['😌', 'Fácil'], ['🙂', 'Bien'], ['😮‍💨', 'Dura'], ['🥵', 'Al límite']];
const ZONES = {legs: 'Pierna y cadera', iso: 'Isométricos', calf: 'Pie y gemelo', plyo: 'Pliometría', upper: 'Tren superior', shoulder: 'Hombro', core: 'Core'};
const EQUIP = {kb: 'Kettlebell', db: 'Mancuernas', band: 'Goma', bar: 'Torre', box: 'Cajón', rope: 'Comba', bw: 'Peso corporal'};

/* ------------------------------------------------------------------ dates */
const urlToday = new URLSearchParams(location.search).get('hoy'); // ?hoy=2026-11-23 for testing
function today() { if (urlToday) return urlToday; const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return fmtD(d); };
const monday = s => { const d = parseD(s); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return fmtD(d); };
const nice = s => { const d = parseD(s); return `${DAYS_L[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const short = s => { const d = parseD(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const mmss = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

/* ------------------------------------------------------------------ storage */
const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('fuerza', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('logs', {keyPath: 'id'}); r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => { const db = await open(); return new Promise((res, rej) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store); const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out); t.onerror = () => rej(t.error); }); };
  return {
    allLogs: () => tx('logs', 'readonly', s => s.getAll()),
    putLog: l => tx('logs', 'readwrite', s => s.put(l)),
    delLog: id => tx('logs', 'readwrite', s => s.delete(id)),
    clearLogs: () => tx('logs', 'readwrite', s => s.clear()),
    get: k => tx('kv', 'readonly', s => s.get(k)),
    set: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)),
    del: k => tx('kv', 'readwrite', s => s.delete(k)),
  };
})();

/* ------------------------------------------------------------------ state */
const S = {ex: {}, exList: [], routines: {}, routineList: [], plan: {}, logs: [], settings: {sound: true, vibrate: true, knee: true}, cur: null, ui: {}};

async function load() {
  const j = u => fetch(u, {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  const [ex, rt, plan] = await Promise.all([j('data/exercises.json'), j('data/routines.json'), j('data/plan.json')]);
  S.exList = ex; ex.forEach(e => S.ex[e.id] = e);
  S.routineList = rt; rt.forEach(r => S.routines[r.id] = r);
  S.plan = plan;
  S.logs = (await DB.allLogs()).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  S.settings = Object.assign(S.settings, await DB.get('settings') || {});
  S.cur = await DB.get('current') || null;
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
}

/* ------------------------------------------------------------------ plan helpers */
function plannedFor(date) {
  const o = (S.plan.dates || {})[date];
  if (o) return typeof o === 'string' ? {routine: o} : o;
  const wd = String(parseD(date).getDay());
  const r = (S.plan.weekly || {})[wd];
  return r ? {routine: r} : null;
}
const logsOn = date => S.logs.filter(l => l.date === date);
const isMain = l => !(S.plan.extras || []).includes(l.routineId);
function weekCount(mon) { const end = addDays(mon, 6); return S.logs.filter(l => l.date >= mon && l.date <= end && isMain(l)).length; }

/* ------------------------------------------------------------------ session engine */
function tempoSum(t) { if (!t) return 0; return t.split('-').reduce((a, b) => a + (+b || 0), 0); }
function buildSteps(routine, swaps = {}) {
  const steps = [];
  routine.blocks.forEach((b, bi) => {
    const exOf = (it, ii) => swaps[`${bi}.${ii}`] || it.ex;
    if (b.circuit) {
      for (let r = 1; r <= b.rounds; r++) b.items.forEach((it, ii) => {
        const last = ii === b.items.length - 1;
        steps.push(mkStep(b, bi, it, ii, exOf(it, ii), r, b.rounds, last ? (r < b.rounds ? b.restRound || 60 : 0) : it.rest ?? 15, true));
      });
    } else b.items.forEach((it, ii) => {
      const n = it.sets || 1;
      for (let s = 1; s <= n; s++) steps.push(mkStep(b, bi, it, ii, exOf(it, ii), s, n, it.rest ?? 60, false));
    });
  });
  return steps;
}
function mkStep(b, bi, it, ii, exId, set, sets, rest, circuit) {
  const e = S.ex[exId] || {name: exId, measure: 'reps'};
  const swapped = exId !== it.ex;
  const range = Array.isArray(it.reps) ? it.reps : null;
  let time = it.time, reps = range ? range[0] : it.reps;
  if (e.measure === 'time' && !time) time = 30;            // swapped reps -> hold
  if (e.measure === 'reps' && !reps) reps = 10;
  return {key: `${bi}.${ii}.${set}`, item: `${bi}.${ii}`, block: b.title, ex: exId, set, sets, circuit,
    measure: e.measure, side: !!e.side, load: e.load || null, reps, repsMax: range ? range[1] : null,
    time: e.measure === 'time' ? time : null, kg: it.kg ?? null, tempo: swapped ? null : it.tempo || null,
    rest, note: swapped ? null : it.note || null, alt: swapped ? null : it.alt || null, origEx: it.ex};
}
function estMinutes(routine) {
  let s = 0, prev = null;
  for (const st of buildSteps(routine)) {
    const sides = st.side ? 2 : 1;
    s += st.measure === 'time' ? st.time * sides + 3 + (st.side ? 5 : 0) : (st.repsMax || st.reps) * (tempoSum(st.tempo) || 3) * sides;
    s += st.rest; if (st.item !== prev) s += 20; prev = st.item;
  }
  return Math.round(s / 60 / 5) * 5 || 5;
}
function lastSetsFor(exId, beforeId) {
  for (let i = S.logs.length - 1; i >= 0; i--) {
    const l = S.logs[i]; if (l.id === beforeId) continue;
    const sets = l.sets.filter(x => x.ex === exId && !x.skipped);
    if (sets.length) return {date: l.date, sets};
  }
  return null;
}
function prefill(st) {
  const last = lastSetsFor(st.ex);
  const p = last ? (last.sets.find(x => x.set === st.set) || last.sets[last.sets.length - 1]) : null;
  return {
    reps: st.measure === 'reps' ? (p && p.reps != null ? p.reps : st.reps) : null,
    time: st.measure === 'time' ? (p && p.time != null ? p.time : st.time) : null,
    kg: st.load ? (p && p.kg != null ? p.kg : (st.kg ?? 0)) : null,
  };
}
function lastText(exId) {
  const l = lastSetsFor(exId); if (!l) return '';
  const e = S.ex[exId] || {};
  const v = l.sets.map(x => e.measure === 'time' ? `${x.time}s` : `${x.reps}`).join(' · ');
  const kg = l.sets.find(x => x.kg) ? ` × ${l.sets.find(x => x.kg).kg} kg` : '';
  return `Última vez (${short(l.date)}): ${v}${kg}`;
}
async function saveCur() { if (S.cur) await DB.set('current', S.cur); else await DB.del('current'); }

async function startRoutine(id) {
  const r = S.routines[id]; if (!r) return;
  audio.unlock();
  S.cur = {id: `${today()}-${Date.now().toString(36)}`, routineId: id, name: r.name, date: today(),
    start: new Date().toISOString(), swaps: {}, idx: 0, res: {}, note: (plannedFor(today()) || {}).note || ''};
  S.cur.steps = buildSteps(r);
  S.cur.vals = {};
  await saveCur();
  go('#/sesion');
}
function curStep() { return S.cur && S.cur.steps[S.cur.idx]; }
function stepVals(st) { return S.cur.vals[st.key] || (S.cur.vals[st.key] = prefill(st)); }

/* ------------------------------------------------------------------ audio / haptics / wake lock */
const audio = (() => {
  let ctx;
  return {
    unlock() { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) {} },
    beep(f = 880, d = 0.12, v = 0.25) {
      if (!S.settings.sound || !ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(v, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + d + 0.02);
    },
  };
})();
const buzz = p => { if (S.settings.vibrate && navigator.vibrate) navigator.vibrate(p); };
let wakeLock = null;
async function wake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && location.hash.startsWith('#/sesion')) wake(true); });

/* ------------------------------------------------------------------ timers (absolute time, survive background) */
let ticker = null;
function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; }
function runTicker(fn) { stopTicker(); let lastBeep = null; ticker = setInterval(() => fn(b => { if (b !== lastBeep) { lastBeep = b; return true; } return false; }), 200); }

/* ------------------------------------------------------------------ rendering helpers */
const app = () => $('#app');
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function imgHTML(e, cls = '') {
  if (!e || !e.images || !e.images.length) return `<div class="ph ${cls}">${esc(e ? e.name : '')}</div>`;
  return `<img src="${esc(e.images[0])}" alt="${esc(e.name)}" loading="lazy">`;
}
const isSvg = e => e && e.images && e.images.length && e.images[0].endsWith('.svg');
function flipHTML(e) {
  if (!e || !e.images || !e.images.length) return `<div class="flip"><div class="ph">${esc(e ? e.name : '')}<br><span class="tiny">sin imagen: sigue los pasos</span></div></div>`;
  return `<div class="flip ${isSvg(e) ? 'svg' : ''}" data-flip>${e.images.map((src, i) => `<img src="${esc(src)}" alt="${esc(e.name)}${i ? '' : ''}" class="${i ? '' : 'on'}">`).join('')}</div>`;
}
let flipTimer = null;
function startFlip() {
  if (flipTimer) clearInterval(flipTimer);
  flipTimer = setInterval(() => document.querySelectorAll('[data-flip]').forEach(f => {
    const imgs = f.querySelectorAll('img'); if (imgs.length < 2) return;
    let i = [...imgs].findIndex(x => x.classList.contains('on')); imgs[i].classList.remove('on'); imgs[(i + 1) % imgs.length].classList.add('on');
  }), 1100);
}
function targetText(st) {
  const sides = st.side ? ' /lado' : '';
  const v = st.measure === 'time' ? `${st.time} s` : st.repsMax ? `${st.reps}–${st.repsMax}` : `${st.reps}`;
  return `${v}${sides}${st.kg ? ` · ${st.kg} kg` : ''}`;
}
function itemSummary(it) {
  const e = S.ex[it.ex] || {name: it.ex};
  const v = it.time ? `${it.time} s` : Array.isArray(it.reps) ? `${it.reps[0]}–${it.reps[1]}` : it.reps;
  return `${it.sets ? it.sets + ' × ' : ''}${v}${e.side ? '/lado' : ''}${it.kg ? ` · ${it.kg} kg` : ''}`;
}
function openSheet(html) { const s = $('#sheet'); s.innerHTML = `<div class="panel">${html}</div>`; s.hidden = false; }
function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet(); });

/* ------------------------------------------------------------------ views */
const views = {};

views.hoy = () => {
  const t = today(), mon = monday(t);
  const plan = plannedFor(t), done = logsOn(t);
  const goal = S.plan.goalPerWeek || 2, wc = weekCount(mon);
  // last 10 weeks
  const weeks = []; for (let i = 9; i >= 0; i--) { const m = addDays(mon, -7 * i); weeks.push({m, n: weekCount(m)}); }
  const streak = (() => { let n = 0; for (let i = weeks.length - 2; i >= 0 && weeks[i].n >= goal; i--) n++; return n + (wc >= goal ? 1 : 0); })();
  const days = [...Array(7)].map((_, i) => { const d = addDays(mon, i); const p = plannedFor(d); const dn = logsOn(d).length > 0;
    return `<div class="d ${dn ? 'done' : p ? 'plan' : ''} ${d === t ? 'today' : ''}"><b>${dn ? '✓' : p ? (S.routines[p.routine] ? esc(S.routines[p.routine].short || '•') : '·') : ''}</b>${DAYS[parseD(d).getDay()]}</div>`; }).join('');

  let html = `<p class="mut small">${esc(nice(t))}</p><h1>Hoy</h1>`;
  if (S.cur) {
    const n = Object.keys(S.cur.res).length;
    html += `<div class="card hero"><h3>Sesión a medias: ${esc(S.cur.name)}</h3><p class="mut small">${n} de ${S.cur.steps.length} series hechas</p>
      <div class="row" style="margin-top:10px"><a class="btn primary grow" href="#/sesion">Continuar</a><button class="btn ghost" data-act="discard">Descartar</button></div></div>`;
  }
  if (done.length) {
    html += done.map(l => `<div class="card"><div class="row between"><h3>✓ ${esc(l.name)}</h3><span style="font-size:1.6rem">${l.feel != null ? FEELS[l.feel][0] : ''}</span></div>
      <p class="mut small">${l.durationMin} min · ${l.sets.filter(x => !x.skipped).length} series${l.prs && l.prs.length ? ` · <span class="pr">🏆 ${l.prs.length} récord${l.prs.length > 1 ? 's' : ''}</span>` : ''}</p></div>`).join('');
  }
  if (plan && S.routines[plan.routine] && !done.some(l => l.routineId === plan.routine) && !(S.cur && S.cur.routineId === plan.routine)) {
    const r = S.routines[plan.routine];
    html += routineCard(r, plan.note, true);
  } else if (!done.length && !S.cur) {
    let next = null; for (let i = 1; i <= 14 && !next; i++) { const d = addDays(t, i); const p = plannedFor(d); if (p && S.routines[p.routine]) next = {d, r: S.routines[p.routine]}; }
    html += `<div class="card"><h3>Hoy no toca fuerza</h3>${next ? `<p class="mut">Próxima: <b>${esc(next.r.name)}</b>, ${esc(nice(next.d))}.</p>` : ''}</div>`;
  }
  html += `<div class="card"><div class="row between"><div><div class="mut small">Esta semana</div><div class="big-num">${wc}<span class="mut" style="font-size:1rem"> / ${goal}</span></div></div>
    <div style="text-align:right"><div class="mut small">${streak ? `🔥 ${streak} semana${streak > 1 ? 's' : ''} seguidas` : 'Racha: empieza esta semana'}</div>
    <div class="streak" title="Últimas 10 semanas">${weeks.map(w => `<i class="${w.n >= goal ? 'ok' : ''}" style="height:${8 + Math.min(w.n, 3) * 6}px"></i>`).join('')}</div></div></div>
    <div class="week">${days}</div>
    ${wc < goal && parseD(t).getDay() === 0 ? `<p class="note">Domingo y ${wc}/${goal}: un Exprés 20' hoy salva la semana.</p>` : ''}</div>`;
  html += `<h2>¿Poco tiempo o algo extra?</h2><div class="row wrap">
    <a class="btn" href="#/rutina/expres-20">⚡ Tengo 20'</a>
    ${(S.plan.extras || []).map(id => S.routines[id] ? `<a class="btn" href="#/rutina/${id}">${esc(S.routines[id].name)}</a>` : '').join('')}
    <button class="btn ghost" data-act="other">Otra rutina…</button></div>`;
  app().innerHTML = html;
  app().onclick = async e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'discard') { if (confirm('¿Descartar la sesión a medias? No se guardará.')) { S.cur = null; await saveCur(); render(); } }
    if (a.dataset.act === 'start') { if (S.cur && !confirm('Hay una sesión a medias. ¿Empezar otra y descartarla?')) return; startRoutine(a.dataset.id); }
    if (a.dataset.act === 'other') openSheet(`<h2 style="margin-top:0">Elegir rutina</h2><ul class="list">${S.routineList.map(r => `<li><a class="li" href="#/rutina/${r.id}" data-close><div class="grow"><b>${esc(r.name)}</b><div class="mut small">~${estMinutes(r)} min · ${esc(r.kit || '')}</div></div>›</a></li>`).join('')}</ul>`);
  };
};

function routineCard(r, note, hero) {
  const items = r.blocks.flatMap(b => b.items.map(it => ({it, b})));
  return `<div class="card ${hero ? 'hero' : ''}"><div class="mut small">Toca hoy · ~${estMinutes(r)} min</div><h1 style="font-size:1.35rem">${esc(r.name)}</h1>
    <p class="mut small">${esc(r.goal || '')}</p>${r.kit ? `<p><span class="chip acc">🏋 ${esc(r.kit)}</span></p>` : ''}
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
    <ul class="list" style="margin:8px 0 12px">${items.map(({it, b}) => { const e = S.ex[it.ex] || {name: it.ex};
      return `<li><div class="thumb ${isSvg(e) ? 'svg' : ''}" style="${isSvg(e) ? 'background:#3E5C76' : ''}">${imgHTML(e)}</div><div class="grow"><b>${esc(e.name)}</b><div class="mut small">${esc(itemSummary(it))}${b.circuit ? ` · circuito ×${b.rounds}` : ''}</div></div></li>`; }).join('')}</ul>
    <button class="btn primary big" data-act="start" data-id="${r.id}">Empezar</button></div>`;
}

views.rutina = (id) => {
  const r = S.routines[id]; if (!r) return go('#/hoy');
  app().innerHTML = `<a href="#/hoy" class="small">‹ Hoy</a>${routineCard(r, null, false)}`;
  app().onclick = e => { const a = e.target.closest('[data-act=start]'); if (a) { if (S.cur && !confirm('Hay una sesión a medias. ¿Empezar otra y descartarla?')) return; startRoutine(a.dataset.id); } };
};

/* ------------------------------------------------------------------ the player */
views.sesion = () => {
  if (!S.cur) return go('#/hoy');
  document.body.classList.add('in-session'); wake(true);
  const st = curStep();
  if (!st) return go('#/fin');
  const e = S.ex[st.ex] || {name: st.ex, cues: []};
  const v = stepVals(st);
  const doneN = Object.keys(S.cur.res).length, N = S.cur.steps.length;
  const exIdx = [...new Set(S.cur.steps.map(s => s.item))]; const exNo = exIdx.indexOf(st.item) + 1;
  const stepper = (k, lab, val, unit) => `<div class="stp"><div class="lab">${lab}</div><div class="ctl"><button data-dec="${k}" aria-label="menos">−</button><span class="val" data-v="${k}">${val}${unit ? `<small style="font-size:.9rem">${unit}</small>` : ''}</span><button data-inc="${k}" aria-label="más">+</button></div></div>`;
  const kgLabel = v.kg ? v.kg : '—';
  const lt = lastText(st.ex);
  app().innerHTML = `
    <div class="ptop"><button class="btn ghost" data-act="menu" aria-label="Menú">✕</button>
      <div class="grow small mut" style="text-align:center">${esc(st.block)} · ejercicio ${exNo}/${exIdx.length}</div>
      <button class="btn ghost" data-act="list" aria-label="Lista">☰</button></div>
    <div class="bar"><i style="width:${Math.round(100 * doneN / N)}%"></i></div>
    ${flipHTML(e)}
    <div class="exname">${esc(e.name)}</div>
    <div class="row wrap"><span class="chip acc">${st.circuit ? 'Ronda' : 'Serie'} ${st.set} de ${st.sets}</span>
      <span class="chip">Objetivo ${esc(targetText(st))}</span>${st.tempo ? `<span class="chip">Tempo ${esc(st.tempo)}</span>` : ''}${st.side ? '<span class="chip">por lado</span>' : ''}</div>
    ${st.note && st.set === 1 ? `<div class="note">${esc(st.note)}</div>` : ''}
    <ul class="cues">${(e.cues || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    <div class="steppers">
      ${st.measure === 'time' ? stepper('time', 'segundos', v.time, '') : stepper('reps', st.side ? 'reps / lado' : 'reps', v.reps, '')}
      ${st.load ? stepper('kg', 'kg', kgLabel, '') : ''}
    </div>
    ${lt ? `<div class="last">${esc(lt)}</div>` : ''}
    <div style="margin-top:14px">
      ${st.measure === 'time'
        ? `<button class="btn primary big" data-act="timer">▶ Empezar ${v.time} s${st.side ? ' por lado' : ''}</button>
           <button class="btn ghost" style="width:100%;margin-top:8px" data-act="done">✓ Ya lo hice</button>`
        : `<button class="btn primary big" data-act="done">✓ Serie hecha</button>`}
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn ghost small" data-act="prev" ${S.cur.idx ? '' : 'disabled'}>‹ Anterior</button>
      ${st.alt && S.ex[st.alt] ? `<button class="btn ghost small grow" data-act="swap">⇄ Cambiar por ${esc(S.ex[st.alt].name)}</button>` : '<span class="grow"></span>'}
      <button class="btn ghost small" data-act="info">ⓘ Cómo</button>
      <button class="btn ghost small" data-act="skip">Saltar</button>
    </div>`;
  startFlip();
  app().onclick = onPlayer;
};

function kgOptions(st) { return st.load === 'kb' ? [0, 12, 16, 20] : [0, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15]; }
async function onPlayer(ev) {
  const st = curStep(); const v = stepVals(st);
  const inc = ev.target.closest('[data-inc]'), dec = ev.target.closest('[data-dec]');
  if (inc || dec) {
    const k = (inc || dec).dataset[inc ? 'inc' : 'dec'], d = inc ? 1 : -1;
    if (k === 'reps') v.reps = Math.max(0, (v.reps || 0) + d);
    if (k === 'time') v.time = Math.max(5, (v.time || 0) + 5 * d);
    if (k === 'kg') { const o = kgOptions(st); let i = o.indexOf(v.kg); if (i < 0) i = o.findIndex(x => x >= v.kg); v.kg = o[Math.min(o.length - 1, Math.max(0, i + d))]; }
    // carry the change forward to the remaining sets of the same exercise
    S.cur.steps.slice(S.cur.idx + 1).filter(s => s.item === st.item && s.ex === st.ex && !S.cur.vals[s.key]).forEach(s => { S.cur.vals[s.key] = Object.assign(prefill(s), {[k]: v[k]}); });
    await saveCur(); return views.sesion();
  }
  const a = ev.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'done') return completeStep(st, {reps: v.reps, time: v.time, kg: v.kg});
  if (act === 'timer') return holdTimer(st, v);
  if (act === 'skip') { S.cur.res[st.key] = {ex: st.ex, set: st.set, skipped: true}; return advance(false); }
  if (act === 'prev') { S.cur.idx = Math.max(0, S.cur.idx - 1); await saveCur(); return views.sesion(); }
  if (act === 'swap') {
    S.cur.swaps[st.item] = st.alt;
    const r = S.routines[S.cur.routineId]; const nsteps = buildSteps(r, S.cur.swaps);
    // keep done steps as they were, replace the rest
    S.cur.steps = S.cur.steps.slice(0, S.cur.idx).concat(nsteps.slice(S.cur.idx));
    await saveCur(); toast(`Cambiado a ${S.ex[st.alt].name}`); return views.sesion();
  }
  if (act === 'info') return openSheet(exDetailHTML(S.ex[st.ex], true));
  if (act === 'list') return openSheet(`<h2 style="margin-top:0">${esc(S.cur.name)}</h2><ul class="list">${S.cur.steps.map((s, i) => {
    const r = S.cur.res[s.key]; const e = S.ex[s.ex] || {name: s.ex};
    return `<li data-jump="${i}" style="cursor:pointer;${i === S.cur.idx ? 'font-weight:700' : ''}"><span style="width:22px">${r ? (r.skipped ? '–' : '✓') : i === S.cur.idx ? '▶' : ''}</span><div class="grow">${esc(e.name)} <span class="mut small">· ${s.circuit ? 'ronda' : 'serie'} ${s.set}/${s.sets}</span></div></li>`; }).join('')}</ul>`);
  if (act === 'menu') return openSheet(`<h2 style="margin-top:0">Sesión</h2>
      <button class="btn primary big" data-act2="finish">Terminar y guardar</button>
      <button class="btn ghost big" style="margin-top:10px" data-act2="pause">Salir (seguir luego)</button>
      <button class="btn ghost big" style="margin-top:10px;color:var(--clay)" data-act2="discard">Descartar sesión</button>`);
}
document.addEventListener('click', async ev => {
  const j = ev.target.closest('#sheet [data-jump]');
  if (j && S.cur) { S.cur.idx = +j.dataset.jump; closeSheet(); await saveCur(); return views.sesion(); }
  const a2 = ev.target.closest('#sheet [data-act2]'); if (!a2) return;
  const act = a2.dataset.act2; closeSheet();
  if (act === 'finish') go('#/fin');
  if (act === 'pause') { wake(false); go('#/hoy'); }
  if (act === 'discard' && confirm('¿Descartar esta sesión? No se guardará nada.')) { S.cur = null; await saveCur(); wake(false); go('#/hoy'); }
});

async function completeStep(st, vals) {
  S.cur.res[st.key] = {ex: st.ex, set: st.set, reps: st.measure === 'reps' ? vals.reps : null, time: st.measure === 'time' ? vals.time : null,
    kg: st.load ? vals.kg || null : null, side: st.side, tempo: st.tempo};
  S.cur.vals[st.key] = Object.assign({}, vals);
  buzz(40);
  return advance(true);
}
async function advance(withRest) {
  const st = curStep();
  // next undone step after current
  let i = S.cur.idx + 1; while (i < S.cur.steps.length && S.cur.res[S.cur.steps[i].key]) i++;
  if (i >= S.cur.steps.length) { i = S.cur.steps.findIndex(s => !S.cur.res[s.key]); }
  if (i < 0) { await saveCur(); return go('#/fin'); }
  S.cur.idx = i; await saveCur();
  if (withRest && st.rest > 0) return restTimer(st.rest, S.cur.steps[i]);
  views.sesion();
}

function overlay(html, cls = '') { app().innerHTML = `<div class="overlay ${cls}">${html}</div>`; }
function ring(frac) { const C = 2 * Math.PI * 110; return `<svg viewBox="0 0 240 240"><circle cx="120" cy="120" r="110" fill="none" stroke="var(--line)" stroke-width="10"/><circle id="arc" cx="120" cy="120" r="110" fill="none" stroke="var(--acc)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>`; }
function setRing(frac) { const a = $('#arc'); if (a) a.setAttribute('stroke-dashoffset', 2 * Math.PI * 110 * (1 - Math.max(0, Math.min(1, frac)))); }

function restTimer(sec, next) {
  const e = S.ex[next.ex] || {name: next.ex};
  let end = Date.now() + sec * 1000, total = sec;
  overlay(`<div class="phase">Descanso</div><div class="ring">${ring(1)}<div class="count" id="cnt">${mmss(sec)}</div></div>
    <div class="row"><button class="btn" id="m15">−15 s</button><button class="btn" id="p15">+15 s</button><button class="btn primary" id="skip">Seguir ›</button></div>
    <div class="next card"><div class="mut small">Siguiente</div><div class="row"><div class="thumb" style="${isSvg(e) ? 'background:#3E5C76' : ''}">${imgHTML(e)}</div><div class="grow" style="text-align:left"><b>${esc(e.name)}</b><div class="mut small">${next.circuit ? 'Ronda' : 'Serie'} ${next.set}/${next.sets} · ${esc(targetText(next))}</div></div></div></div>`);
  const done = () => { stopTicker(); views.sesion(); };
  $('#skip').onclick = done;
  $('#p15').onclick = () => { end += 15000; total += 15; };
  $('#m15').onclick = () => { end -= 15000; };
  runTicker(once => {
    const left = (end - Date.now()) / 1000; const c = $('#cnt'); if (!c) return stopTicker();
    c.textContent = mmss(Math.ceil(left)); setRing(left / total);
    const s = Math.ceil(left);
    if (s <= 3 && s > 0 && once(s)) audio.beep(660, 0.1);
    if (left <= 0) { if (once('end')) { audio.beep(990, 0.35); buzz([200, 100, 200]); } done(); }
  });
}

function holdTimer(st, v) {
  audio.unlock();
  const e = S.ex[st.ex] || {name: st.ex};
  const phases = [{k: 'prep', t: 3, lab: 'Prepárate'}, {k: 'work', t: v.time, lab: st.side ? 'Lado 1' : 'Aguanta'}];
  if (st.side) phases.push({k: 'switch', t: 5, lab: 'Cambia de lado'}, {k: 'work', t: v.time, lab: 'Lado 2'});
  let pi = 0, end = Date.now() + phases[0].t * 1000, paused = null, held = [];
  const draw = () => overlay(`<div class="phase" id="ph">${phases[pi].lab}</div><div class="ring">${ring(1)}<div class="count" id="cnt">${phases[pi].t}</div></div>
    <div class="exname" style="margin-top:12px">${esc(e.name)}</div>
    <div class="row"><button class="btn" id="pause">Pausa</button><button class="btn primary" id="stop">Parar y guardar</button></div>
    <button class="btn ghost small" id="cancel" style="margin-top:14px">Cancelar</button>`, phases[pi].k === 'work' ? 'work' : '');
  draw();
  const finish = () => { stopTicker(); const t = held.length ? Math.round(Math.min(...held)) : v.time; completeStep(st, {time: t, kg: v.kg}); };
  const bind = () => {
    $('#pause').onclick = () => { if (paused == null) { paused = end - Date.now(); $('#pause').textContent = 'Seguir'; } else { end = Date.now() + paused; paused = null; $('#pause').textContent = 'Pausa'; } };
    $('#stop').onclick = () => { const p = phases[pi]; if (p.k === 'work') held.push(p.t - Math.max(0, (end - Date.now()) / 1000)); finish(); };
    $('#cancel').onclick = () => { stopTicker(); views.sesion(); };
  };
  bind();
  runTicker(once => {
    if (paused != null) return;
    const p = phases[pi]; const left = (end - Date.now()) / 1000; const c = $('#cnt'); if (!c) return stopTicker();
    const s = Math.ceil(left); c.textContent = s; setRing(left / p.t);
    if (s <= 3 && s > 0 && once(`${pi}-${s}`)) audio.beep(p.k === 'work' ? 660 : 520, 0.1);
    if (left <= 0) {
      if (p.k === 'work') held.push(p.t);
      if (once(`${pi}-end`)) { audio.beep(990, 0.3); buzz(p.k === 'work' ? [200, 80, 200] : 120); }
      pi++;
      if (pi >= phases.length) return finish();
      end = Date.now() + phases[pi].t * 1000; draw(); bind();
    }
  });
}

/* ------------------------------------------------------------------ finish */
function bestOf(exId, sets) {
  const e = S.ex[exId] || {};
  let b = null;
  for (const x of sets) {
    if (x.skipped) continue;
    const score = e.measure === 'time' ? (x.time || 0) * (1 + (x.kg || 0) / 40) : x.kg ? x.kg * (1 + (x.reps || 0) / 30) : (x.reps || 0);
    if (!b || score > b.score) b = {score, x};
  }
  return b;
}
function bestText(exId, x) { const e = S.ex[exId] || {}; return e.measure === 'time' ? `${x.time} s${x.kg ? ` · ${x.kg} kg` : ''}` : `${x.reps} reps${x.kg ? ` × ${x.kg} kg` : ''}`; }
function findPRs(log) {
  const prs = [];
  const exs = [...new Set(log.sets.map(s => s.ex))];
  for (const ex of exs) {
    const now = bestOf(ex, log.sets.filter(s => s.ex === ex)); if (!now) continue;
    const prevSets = S.logs.filter(l => l.id !== log.id).flatMap(l => l.sets.filter(s => s.ex === ex));
    if (!prevSets.length) continue;
    const prev = bestOf(ex, prevSets);
    if (prev && now.score > prev.score + 1e-9) prs.push({ex, now: bestText(ex, now.x), prev: bestText(ex, prev.x)});
  }
  return prs;
}
function curToLog() {
  const sets = S.cur.steps.map(s => S.cur.res[s.key]).filter(Boolean);
  const end = new Date();
  const tut = sets.reduce((a, x) => a + (x.skipped ? 0 : (x.time || 0) * (x.side ? 2 : 1) + (x.reps || 0) * (tempoSum(x.tempo) || 3) * (x.side ? 2 : 1)), 0);
  return {id: S.cur.id, date: S.cur.date, routineId: S.cur.routineId, name: S.cur.name, start: S.cur.start, end: end.toISOString(),
    durationMin: Math.max(1, Math.round((end - new Date(S.cur.start)) / 60000)), tutSec: tut, sets,
    feel: S.cur.feel ?? null, knee: S.cur.knee ?? null, notes: S.cur.notes || '', app: VERSION};
}
views.fin = () => {
  if (!S.cur) return go('#/hoy');
  document.body.classList.add('in-session');
  const log = curToLog(); const prs = findPRs(log);
  const n = log.sets.filter(x => !x.skipped).length, N = S.cur.steps.length;
  app().innerHTML = `<h1>¡Hecho! 💪</h1><p class="mut">${esc(S.cur.name)}</p>
    <div class="card"><div class="row between" style="text-align:center">
      <div class="grow"><div class="big-num">${log.durationMin}</div><div class="mut small">min</div></div>
      <div class="grow"><div class="big-num">${n}<span class="mut" style="font-size:1rem">/${N}</span></div><div class="mut small">series</div></div>
      <div class="grow"><div class="big-num">${Math.round(log.tutSec / 60)}</div><div class="mut small">min en tensión</div></div></div></div>
    ${prs.length ? `<div class="card"><h3 class="pr">🏆 ${prs.length === 1 ? 'Nuevo récord' : prs.length + ' récords'}</h3><ul class="list">${prs.map(p => `<li><div class="grow"><b>${esc(S.ex[p.ex].name)}</b><div class="small mut">${esc(p.now)} <span class="tiny">(antes ${esc(p.prev)})</span></div></div></li>`).join('')}</ul></div>` : ''}
    <h2>¿Cómo fue?</h2><div class="feel">${FEELS.map((f, i) => `<button data-feel="${i}" class="${S.cur.feel === i ? 'on' : ''}">${f[0]}<small>${f[1]}</small></button>`).join('')}</div>
    ${S.settings.knee ? `<h2>Rodilla (0 = nada, 10 = mucho): <span id="kv">${S.cur.knee ?? 0}</span></h2><input type="range" min="0" max="10" step="1" value="${S.cur.knee ?? 0}" id="knee">` : ''}
    <h2>Notas (opcional)</h2><textarea id="notes" rows="2" placeholder="p. ej. la búlgara izquierda cuesta más">${esc(S.cur.notes || '')}</textarea>
    <button class="btn primary big" style="margin-top:16px" id="save">Guardar sesión</button>
    ${n < N ? `<button class="btn ghost big" style="margin-top:8px" id="back">Volver a la sesión</button>` : ''}`;
  app().onclick = async ev => {
    const f = ev.target.closest('[data-feel]');
    if (f) { S.cur.feel = +f.dataset.feel; await saveCur(); document.querySelectorAll('[data-feel]').forEach(b => b.classList.toggle('on', b === f)); }
  };
  const k = $('#knee'); if (k) k.oninput = () => { S.cur.knee = +k.value; $('#kv').textContent = k.value; saveCur(); };
  $('#notes').oninput = e => { S.cur.notes = e.target.value; saveCur(); };
  const b = $('#back'); if (b) b.onclick = () => go('#/sesion');
  $('#save').onclick = async () => {
    const lg = curToLog(); lg.prs = findPRs(lg);
    await DB.putLog(lg); S.logs.push(lg); S.cur = null; await saveCur(); wake(false);
    const mon = monday(today()); const wc = weekCount(mon), goal = S.plan.goalPerWeek || 2;
    toast(wc >= goal ? `Semana completada: ${wc}/${goal} ✓` : `Guardada · semana ${wc}/${goal}`);
    go('#/hoy');
  };
};

/* ------------------------------------------------------------------ history & progress */
views.historial = (sub) => {
  const tab = sub === 'ejercicios' ? 'ex' : 'ses';
  let html = `<h1>Historial</h1><div class="filters"><button class="${tab === 'ses' ? 'on' : ''}" data-go="#/historial">Sesiones</button><button class="${tab === 'ex' ? 'on' : ''}" data-go="#/historial/ejercicios">Por ejercicio</button></div>`;
  if (!S.logs.length) html += `<div class="card"><p>Aún no hay sesiones. La primera, desde <a href="#/hoy">Hoy</a>.</p></div>`;
  else if (tab === 'ses') {
    const byWeek = {};
    [...S.logs].reverse().forEach(l => (byWeek[monday(l.date)] = byWeek[monday(l.date)] || []).push(l));
    for (const [m, ls] of Object.entries(byWeek)) {
      const n = ls.filter(isMain).length;
      html += `<h2>Semana del ${esc(short(m))} <span class="chip ${n >= (S.plan.goalPerWeek || 2) ? 'acc' : ''}">${n}/${S.plan.goalPerWeek || 2}</span></h2><div class="card"><ul class="list">${ls.map(l =>
        `<li><a class="li" href="#/log/${encodeURIComponent(l.id)}"><div class="grow"><b>${esc(l.name)}</b><div class="mut small">${esc(short(l.date))} · ${l.durationMin} min · ${l.sets.filter(x => !x.skipped).length} series${l.knee != null ? ` · rodilla ${l.knee}/10` : ''}${l.prs && l.prs.length ? ' · <span class="pr">🏆</span>' : ''}</div></div><span style="font-size:1.4rem">${l.feel != null ? FEELS[l.feel][0] : ''}</span></a></li>`).join('')}</ul></div>`;
    }
  } else {
    const cnt = {}; S.logs.forEach(l => new Set(l.sets.filter(s => !s.skipped).map(s => s.ex)).forEach(ex => cnt[ex] = (cnt[ex] || 0) + 1));
    const ids = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
    html += `<div class="card"><ul class="list">${ids.map(id => { const e = S.ex[id] || {name: id}; const b = bestOf(id, S.logs.flatMap(l => l.sets.filter(s => s.ex === id)));
      return `<li><a class="li" href="#/ex/${id}"><div class="thumb" style="${isSvg(e) ? 'background:#3E5C76' : ''}">${imgHTML(e)}</div><div class="grow"><b>${esc(e.name)}</b><div class="mut small">${cnt[id]} sesión${cnt[id] > 1 ? 'es' : ''}${b ? ` · mejor: ${esc(bestText(id, b.x))}` : ''}</div></div>›</a></li>`; }).join('')}</ul></div>`;
  }
  app().innerHTML = html;
  app().onclick = e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); };
};

views.log = (id) => {
  const l = S.logs.find(x => x.id === id); if (!l) return go('#/historial');
  const rows = l.sets.map(s => { const e = S.ex[s.ex] || {name: s.ex, measure: 'reps'};
    return `<tr><td>${esc(e.name)}</td><td>${s.set}</td><td>${s.skipped ? '<span class="mut">saltada</span>' : esc(e.measure === 'time' ? `${s.time} s` : `${s.reps}`)}${s.side ? '<span class="tiny mut"> /lado</span>' : ''}</td><td>${s.kg ? s.kg + ' kg' : ''}</td></tr>`; }).join('');
  app().innerHTML = `<a href="#/historial" class="small">‹ Historial</a><h1>${esc(l.name)}</h1>
    <p class="mut">${esc(nice(l.date))} · ${l.durationMin} min · ${Math.round((l.tutSec || 0) / 60)} min en tensión ${l.feel != null ? '· ' + FEELS[l.feel][0] : ''}${l.knee != null ? ` · rodilla ${l.knee}/10` : ''}</p>
    ${l.notes ? `<div class="note">${esc(l.notes)}</div>` : ''}
    ${l.prs && l.prs.length ? `<p class="pr">🏆 ${l.prs.map(p => esc((S.ex[p.ex] || {name: p.ex}).name) + ': ' + esc(p.now)).join(' · ')}</p>` : ''}
    <div class="card"><table><tr><th>Ejercicio</th><th>Serie</th><th>Hecho</th><th>Carga</th></tr>${rows}</table></div>
    <button class="btn ghost" id="del" style="color:var(--clay)">Borrar esta sesión</button>`;
  $('#del').onclick = async () => { if (!confirm('¿Borrar esta sesión del historial?')) return; await DB.delLog(id); S.logs = S.logs.filter(x => x.id !== id); go('#/historial'); };
};

function sparkline(points) {
  if (points.length < 2) return '';
  const W = 600, H = 90, P = 8; const ys = points.map(p => p.y); const lo = Math.min(...ys), hi = Math.max(...ys); const span = hi - lo || 1;
  const xy = points.map((p, i) => [P + i * (W - 2 * P) / (points.length - 1), H - P - (p.y - lo) / span * (H - 2 * P)]);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolución"><polyline fill="none" stroke="var(--acc)" stroke-width="3" points="${xy.map(p => p.join(',')).join(' ')}"/>${xy.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--acc)"/>`).join('')}</svg>`;
}
views.ex = (id) => {
  const e = S.ex[id]; if (!e) return go('#/catalogo');
  const sess = S.logs.map(l => ({l, sets: l.sets.filter(s => s.ex === id && !s.skipped)})).filter(x => x.sets.length);
  const pts = sess.map(x => ({y: bestOf(id, x.sets).score}));
  app().innerHTML = `<a href="javascript:history.back()" class="small">‹ Volver</a><h1>${esc(e.name)}</h1>
    ${sess.length ? `<div class="card"><div class="mut small">Mejor serie por sesión${e.measure === 'time' ? ' (segundos)' : e.load ? ' (kg × reps, en fuerza estimada)' : ' (reps)'}</div>${sparkline(pts) || '<p class="mut small">Con dos sesiones aparecerá la gráfica.</p>'}
      <table><tr><th>Fecha</th><th>Series</th></tr>${[...sess].reverse().map(x => `<tr><td>${esc(short(x.l.date))}</td><td>${x.sets.map(s => esc(e.measure === 'time' ? s.time + 's' : String(s.reps))).join(' · ')}${x.sets.find(s => s.kg) ? ` × ${x.sets.find(s => s.kg).kg} kg` : ''}</td></tr>`).join('')}</table></div>`
      : '<div class="card"><p class="mut">Todavía no lo has hecho.</p></div>'}
    ${exDetailHTML(e, false)}`;
  startFlip();
};

/* ------------------------------------------------------------------ catalogue */
function exDetailHTML(e, inSheet) {
  if (!e) return '';
  const credit = e.credit === 'repdb' ? 'Exercise data by <a href="https://repdb.co" target="_blank" rel="noopener">RepDB (repdb.co)</a>'
    : e.credit === 'wg' ? 'Ilustración: <a href="https://github.com/bryllim/workout-guide" target="_blank" rel="noopener">Workout Guide</a> (Bryl Lim, sobre Everkinetic) · CC BY-SA 4.0' : '';
  return `${inSheet ? `<div class="row between"><h2 style="margin:0">${esc(e.name)}</h2><button class="btn small ghost" data-close>Cerrar</button></div>` : ''}
    <div style="margin-top:10px">${flipHTML(e)}</div>
    <p style="margin-top:12px"><b>Por qué:</b> ${esc(e.why || '')}</p>
    <p class="mut">${esc(e.desc || '')}</p>
    <div>${(e.equip || []).map(q => `<span class="chip">${esc(EQUIP[q] || q)}</span>`).join('')}<span class="chip">${e.measure === 'time' ? 'Por tiempo' : 'Por repeticiones'}${e.side ? ' · por lado' : ''}</span>${e.knee === 'care' ? '<span class="chip warn">Rodilla: vigilar dolor</span>' : e.knee === 'avoid' ? '<span class="chip warn">Rodilla: aún no</span>' : '<span class="chip acc">Rodilla OK</span>'}</div>
    <h2>Claves</h2><ul class="cues">${(e.cues || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    ${e.steps && e.steps.length ? `<h2>Paso a paso</h2><ol class="cues">${e.steps.map(c => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}
    ${e.tips && e.tips.length ? `<h2>Consejos</h2><ul class="cues">${e.tips.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    ${credit ? `<p class="tiny mut" style="margin-top:16px">${credit}</p>` : ''}`;
}
views.catalogo = () => {
  const f = S.ui.zone || 'all', q = (S.ui.q || '').toLowerCase();
  const list = S.exList.filter(e => (f === 'all' || e.zone === f) && (!q || (e.name + ' ' + (e.desc || '')).toLowerCase().includes(q)));
  app().innerHTML = `<h1>Ejercicios</h1><input type="search" id="q" placeholder="Buscar (squat, gemelo, goma…)" value="${esc(S.ui.q || '')}">
    <div class="filters"><button data-z="all" class="${f === 'all' ? 'on' : ''}">Todos</button>${Object.entries(ZONES).map(([k, v]) => `<button data-z="${k}" class="${f === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div class="grid">${list.map(e => `<a class="tile" href="#/cat/${e.id}"><div class="im ${isSvg(e) ? 'svg' : ''}">${imgHTML(e)}</div><div class="t">${esc(e.name)}<div class="tiny mut">${esc(ZONES[e.zone] || '')}</div></div></a>`).join('')}</div>
    <p class="tiny mut" style="margin-top:16px">Exercise data by <a href="https://repdb.co" target="_blank" rel="noopener">RepDB (repdb.co)</a> · ilustraciones adicionales de Workout Guide (CC BY-SA 4.0).</p>`;
  $('#q').oninput = ev => { S.ui.q = ev.target.value; const pos = ev.target.selectionStart; views.catalogo(); const i = $('#q'); i.focus(); i.setSelectionRange(pos, pos); };
  app().onclick = ev => { const z = ev.target.closest('[data-z]'); if (z) { S.ui.zone = z.dataset.z; views.catalogo(); } };
};
views.cat = (id) => {
  const e = S.ex[id]; if (!e) return go('#/catalogo');
  const has = S.logs.some(l => l.sets.some(s => s.ex === id));
  app().innerHTML = `<a href="#/catalogo" class="small">‹ Ejercicios</a><h1>${esc(e.name)}</h1>${exDetailHTML(e, false)}${has ? `<p><a class="btn" href="#/ex/${id}">Ver mi progreso</a></p>` : ''}`;
  startFlip();
};

/* ------------------------------------------------------------------ settings */
views.ajustes = () => {
  const s = S.settings;
  const tog = (k, lab) => `<li><label class="row grow" style="cursor:pointer"><span class="grow">${lab}</span><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--acc)"></label></li>`;
  app().innerHTML = `<h1>Ajustes</h1>
    <div class="card"><ul class="list">${tog('sound', 'Pitidos en descansos y sostenes')}${tog('vibrate', 'Vibración')}${tog('knee', 'Preguntar por la rodilla al terminar')}</ul></div>
    <h2>Tus datos</h2><div class="card"><p class="small mut">${S.logs.length} sesiones guardadas en este dispositivo. Hasta que llegue la sincronización (fase 2), haz una copia de vez en cuando.</p>
      <div class="row wrap" style="margin-top:8px"><button class="btn" id="exp">⬇ Exportar copia</button><label class="btn ghost">⬆ Importar<input type="file" id="imp" accept="application/json" hidden></label></div></div>
    <h2>Rutinas</h2><div class="card"><ul class="list">${S.routineList.map(r => `<li><a class="li" href="#/rutina/${r.id}"><div class="grow"><b>${esc(r.name)}</b><div class="mut small">~${estMinutes(r)} min</div></div>›</a></li>`).join('')}</ul></div>
    <h2>Créditos</h2><div class="card small"><p>Exercise data by <a href="https://repdb.co" target="_blank" rel="noopener">RepDB (repdb.co)</a>: textos en español e ilustraciones.</p>
      <p>Ilustraciones adicionales: <a href="https://github.com/bryllim/workout-guide" target="_blank" rel="noopener">Workout Guide</a> de Bryl Lim, basadas en Everkinetic, bajo <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.</p>
      <p class="mut">Fuerza v${VERSION} · plan actualizado ${esc(S.plan.updated || '')}</p></div>
    <button class="btn ghost" id="wipe" style="color:var(--clay);margin-top:8px">Borrar todo el historial</button>`;
  app().onchange = async ev => {
    const c = ev.target.closest('[data-set]');
    if (c) { S.settings[c.dataset.set] = c.checked; await DB.set('settings', S.settings); }
    if (ev.target.id === 'imp' && ev.target.files[0]) {
      try {
        const d = JSON.parse(await ev.target.files[0].text()); let n = 0;
        for (const l of d.logs || []) { if (l && l.id && Array.isArray(l.sets)) { await DB.putLog(l); n++; } }
        S.logs = (await DB.allLogs()).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
        toast(`${n} sesiones importadas`); views.ajustes();
      } catch (e) { toast('No se pudo leer ese archivo'); }
    }
  };
  $('#exp').onclick = () => {
    const blob = new Blob([JSON.stringify({app: 'fuerza', version: VERSION, exportedAt: new Date().toISOString(), logs: S.logs, settings: S.settings}, null, 1)], {type: 'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fuerza-copia-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#wipe').onclick = async () => { if (!confirm('¿Borrar TODAS las sesiones de este dispositivo? No se puede deshacer (salvo que tengas una copia exportada).')) return; await DB.clearLogs(); S.logs = []; views.ajustes(); };
};

/* ------------------------------------------------------------------ router */
function go(h) { if (location.hash === h) render(); else location.hash = h; }
function render() {
  stopTicker(); closeSheet();
  const [, name = 'hoy', arg] = (location.hash || '#/hoy').split('/');
  if (name !== 'sesion' && name !== 'fin') document.body.classList.remove('in-session');
  const tab = {hoy: 'hoy', rutina: 'hoy', historial: 'historial', log: 'historial', ex: 'historial', catalogo: 'catalogo', cat: 'catalogo', ajustes: 'ajustes'}[name];
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  app().onclick = null; app().onchange = null;
  (views[name] || views.hoy)(arg && decodeURIComponent(arg));
  if (name !== 'sesion') window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

(async () => {
  try { await load(); } catch (e) { app().innerHTML = `<div class="card"><h3>No se pudieron cargar los datos</h3><p class="mut small">${esc(e.message)}</p><p>Abre la app con conexión una vez para que se guarde en el móvil.</p></div>`; return; }
  if (!location.hash && S.cur) location.hash = '#/hoy';
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
