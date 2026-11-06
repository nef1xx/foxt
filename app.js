(() => {
  'use strict';
  const { nominations, archive, voting, year } = window.BRATKI;
  const $ = (selector, root = document) => root.querySelector(selector);
  const storageKey = `bratki-${year}-shortlist-v1`;
  const symbols = {
    crown: '<path d="m12 57-5-36 24 16L40 9l10 28 24-16-6 36Z"/><path d="M13 65h54M20 50h40"/><circle cx="40" cy="44" r="3"/>',
    smile: '<circle cx="40" cy="40" r="28"/><path d="M25 45q15 23 30 0M28 28v5m24-5v5"/><path d="m16 16 5 5m43-5-5 5"/>',
    target: '<circle cx="40" cy="40" r="24"/><circle cx="40" cy="40" r="13"/><path d="M40 5v21m0 28v21M5 40h21m28 0h21"/><circle cx="40" cy="40" r="3"/>',
    wave: '<path d="M8 35v10m8-20v30m8-36v42m8-32v22m8-42v62m8-45v28m8-35v42m8-36v30m8-20v10"/>',
    return: '<path d="M18 29a27 27 0 1 1-2 25M10 12v23h23"/><path d="m33 41 10-10v22m-8 0h16"/>',
    duo: '<circle cx="27" cy="27" r="12"/><circle cx="55" cy="30" r="10"/><path d="M7 65v-7c0-19 39-19 39 0v7ZM48 46c14-4 25 4 25 15v4H52"/>',
    sun: '<circle cx="40" cy="40" r="18"/><path d="M40 4v9m0 54v9M4 40h9m54 0h9M15 15l7 7m36 36 7 7M15 65l7-7m36-36 7-7M32 43q8 10 16 0"/>',
    star: '<path d="M40 5c4 25 10 31 35 35-25 4-31 10-35 35C36 50 30 44 5 40 30 36 36 30 40 5Z"/><path d="m60 8 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z"/>',
    quote: '<path d="M12 17h56v39H40L24 69V56H12Z"/><path d="M26 31v11h9V31h-9l-3 5m23-5v11h9V31h-9l-3 5"/>',
    bolt: '<path d="m46 5-31 40h23l-5 30 33-43H43Z"/><path d="m12 14 7 4m44 43 7 4M10 61l7-5m47-42 6-4"/>',
    play: '<rect x="8" y="17" width="64" height="47" rx="5"/><path d="m33 29 20 12-20 12ZM16 9h48m-48 63h48"/>',
    heart: '<path d="M40 68 13 41C-4 21 20 2 40 24 60 2 84 21 67 41Z"/><path d="M18 39h13l6-11 8 22 6-11h11"/>',
    cloud: '<path d="M20 48a13 13 0 0 1-1-26 21 21 0 0 1 40 2 12 12 0 0 1 1 24Z"/><path d="m29 57-5 12m20-12-5 12m20-12-5 12"/>',
    pin: '<path d="M25 10h30l-5 22 12 14v6H18v-6l12-14ZM40 52v22M25 10h30"/>',
  };
  function icon(name) { return `<svg viewBox="0 0 80 80" class="symbol-svg" aria-hidden="true">${symbols[name] || symbols.star}</svg>`; }
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  let shortlist = {};
  let storageAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const n of nominations) {
        const value = saved[n.id];
        if (value && typeof value.candidate === 'string' && value.candidate.trim()) {
          shortlist[n.id] = { candidate: value.candidate.trim().slice(0, 80), reason: typeof value.reason === 'string' ? value.reason.slice(0, 500) : '' };
        }
      }
    }
  } catch { storageAvailable = false; }
  let filter = 'all';
  let currentNomination = null;
  let toastTimer;
  const grid = $('#nomination-grid');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const dialogs = document.querySelectorAll('dialog');
  let lastFocus;
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200); }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(shortlist)); storageAvailable = true; }
    catch { storageAvailable = false; }
    document.querySelectorAll('.shortlist-count').forEach(node => { node.textContent = Object.keys(shortlist).length; node.classList.toggle('has-choices', Object.keys(shortlist).length > 0); });
  }
  function openDialog(dialog) {
    lastFocus = document.activeElement;
    dialogs.forEach(other => { if (other.open) other.close(); });
    dialog.showModal(); document.body.style.overflow = 'hidden';
  }
  dialogs.forEach(dialog => {
    dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
    dialog.addEventListener('close', () => { if (![...dialogs].some(d => d.open)) { document.body.style.overflow = ''; const focusTarget = lastFocus?.isConnected && !lastFocus.closest('dialog:not([open])') ? lastFocus : $('[data-open-shortlist]'); focusTarget?.focus({preventScroll:true}); } });
  });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  function renderNominations() {
    grid.replaceChildren();
    const groups = [
      { type: 'main', title: 'Основные номинации', note: 'Все четыре — в голосовании' },
      { type: 'additional', title: 'Дополнительные номинации', note: `В голосование попадут только ${voting.additionalSlots} из четырёх` },
    ];
    groups.filter(group => filter === 'all' || group.type === filter).forEach(group => {
      const heading = el('div', 'nomination-group-heading');
      heading.append(el('h3', '', group.title), el('p', '', group.note));
      grid.append(heading);
      nominations.filter(n => n.type === group.type).forEach(n => {
        const index = nominations.indexOf(n) + 1;
        const selected = shortlist[n.id];
        const card = el('button', `nomination-card reveal${selected ? ' selected' : ''}`);
        card.type = 'button'; card.dataset.nomination = n.id;
        card.setAttribute('aria-label', `${n.title}${selected ? ', в шорт-листе' : ''}. Открыть номинацию`);
        card.style.setProperty('--reveal-delay', `${((index - 1) % 4) * .08}s`);
        card.innerHTML = `<div class="card-top"><span class="card-index">${String(index).padStart(2, '0')} / 08</span><span class="card-tag ${n.type === 'additional' ? 'additional' : ''}">${selected ? '<span class="selected-label">✓ В ШОРТ-ЛИСТЕ</span>' : n.tag.toUpperCase()}</span></div><div class="card-art"><img src="./assets/cosmic/${n.id}.webp" alt="" loading="lazy" decoding="async" width="1024" height="1536"></div><div class="card-body"><h4>${n.title}</h4><p>${n.description}</p><span class="card-arrow" aria-hidden="true">${selected ? '✓' : '↗'}</span></div>`;
        card.addEventListener('click', () => openNomination(n));
        card.addEventListener('pointermove', event => {
          if (!animationEnabled || event.pointerType !== 'mouse') return;
          const rect = card.getBoundingClientRect();
          card.style.setProperty('--tilt-x', `${(0.5 - (event.clientY - rect.top) / rect.height) * 5}deg`);
          card.style.setProperty('--tilt-y', `${((event.clientX - rect.left) / rect.width - 0.5) * 5}deg`);
        });
        card.addEventListener('pointerleave', () => { card.style.setProperty('--tilt-x', '0deg'); card.style.setProperty('--tilt-y', '0deg'); });
        grid.append(card);
        revealObserver.observe(card);
      });
    });
  }
  function openNomination(n) {
    currentNomination = n;
    const saved = shortlist[n.id];
    $('#nomination-label').textContent = n.label || `${n.type === 'additional' ? 'ДОПОЛНИТЕЛЬНАЯ НОМИНАЦИЯ' : 'ОСНОВНАЯ НОМИНАЦИЯ'} / BRATKI ${year}`;
    $('#nomination-title').textContent = n.title;
    $('#nomination-dialog').setAttribute('aria-labelledby', 'nomination-title');
    $('#nomination-description').textContent = n.criteria + (n.type === 'additional' ? ` В голосование попадут только ${voting.additionalSlots} из четырёх дополнительных номинаций.` : '');
    $('#nomination-symbol').replaceChildren();
    const artwork = el('img'); artwork.src = `./assets/cosmic/${n.id}.webp`; artwork.alt = '';
    $('#nomination-symbol').append(artwork);
    $('#previous-winner').textContent = n.previous ? `В 2025 награду забрал: ${n.previous}` : '';
    $('#previous-winner').hidden = !n.previous;
    $('#candidate').value = saved?.candidate || '';
    $('#candidate').setCustomValidity('');
    $('#reason').value = saved?.reason || '';
    $('#remove-choice').hidden = !saved;
    openDialog($('#nomination-dialog'));
  }
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b => { const active = b === button; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    renderNominations();
  }));
  $('#candidate').addEventListener('input', () => $('#candidate').setCustomValidity(''));
  $('#nomination-form').addEventListener('submit', event => {
    event.preventDefault();
    const candidate = $('#candidate').value.trim();
    if (!candidate) { $('#candidate').setCustomValidity('Впиши имя, ник или название момента.'); $('#candidate').reportValidity(); return; }
    const id = currentNomination.id;
    shortlist[id] = { candidate, reason: $('#reason').value.trim() };
    persist(); $('#nomination-dialog').close(); renderNominations();
    $(`[data-nomination="${id}"]`)?.focus({preventScroll:true});
    toast(storageAvailable ? 'В шорт-листе! Это черновик, не отправленный голос.' : 'Выбор в памяти вкладки. Браузер блокирует сохранение — скачай список.');
  });
  $('#remove-choice').addEventListener('click', () => { const id = currentNomination.id; delete shortlist[id]; persist(); $('#nomination-dialog').close(); renderNominations(); $(`[data-nomination="${id}"]`)?.focus({preventScroll:true}); toast('Номинация убрана из шорт-листа'); });
  function renderShortlist() {
    const content = $('#shortlist-content'); content.replaceChildren();
    const chosen = nominations.filter(n => shortlist[n.id]);
    $('#shortlist-actions').hidden = chosen.length === 0;
    $('#shortlist-actions').style.display = chosen.length ? '' : 'none';
    if (!chosen.length) {
      const empty = el('div', 'empty-shortlist'); empty.innerHTML = `${icon('crown')}<h3>Все легенды ещё впереди</h3><p>Открой номинацию и добавь своего кандидата.<br>Здесь соберётся твой личный список.</p>`;
      const button = el('button', 'button button-primary', 'К номинациям ↗'); button.addEventListener('click', () => { $('#shortlist-dialog').close(); $('#nominations').scrollIntoView(); }); empty.append(button); content.append(empty); return;
    }
    for (const n of chosen) {
      const choice = shortlist[n.id];
      const row = el('div', 'shortlist-row'); const text = el('div');
      text.append(el('h3', '', n.title), el('p', '', choice.candidate));
      if (choice.reason) text.append(el('small', '', choice.reason));
      const edit = el('button', 'edit-shortlist', '↗'); edit.setAttribute('aria-label', `Изменить выбор: ${n.title}`); edit.addEventListener('click', () => openNomination(n));
      row.append(text, edit); content.append(row);
    }
  }
  document.querySelectorAll('[data-open-shortlist]').forEach(button => button.addEventListener('click', () => { renderShortlist(); openDialog($('#shortlist-dialog')); }));
  $('#clear-shortlist').addEventListener('click', () => { shortlist = {}; persist(); renderNominations(); renderShortlist(); toast('Шорт-лист очищен'); $('#shortlist-title').tabIndex = -1; $('#shortlist-title').focus(); });
  $('#download-shortlist').addEventListener('click', () => {
    const lines = [`BRATKI ${year} — личный шорт-лист`, 'ЧЕРНОВИК. Не отправленный голос.', ''];
    for (const n of nominations) { const choice = shortlist[n.id]; if (choice) lines.push(`${n.title}: ${choice.candidate}`, ...(choice.reason ? [`Момент: ${choice.reason}`] : []), ''); }
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob); const a = el('a'); a.href = url; a.download = `BRATKI-${year}-shortlist.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Личный шорт-лист сохранён файлом');
  });
  archive.forEach(winner => { const card = el('article', `legacy-card${winner.main ? ' main' : ''}`); card.innerHTML = icon(winner.icon); const text = el('div'); text.append(el('p', '', winner.title), el('h3', '', winner.name)); card.append(text); $('#legacy-grid').append(card); });
  const votingURL = (() => { try { const url = new URL(voting.url); return url.protocol === 'https:' ? url.href : null; } catch { return null; } })();
  $('#voting-action').addEventListener('click', () => { if (voting.status === 'open' && votingURL) location.assign(votingURL); else openDialog($('#rules-dialog')); });
  if (voting.status === 'open' && votingURL) {
    $('#voting-action').innerHTML = 'Перейти к голосованию <span aria-hidden="true">↗</span>';
    $('.status').innerHTML = '<span></span> СЕЗОН 2026 · ГОЛОСОВАНИЕ ОТКРЫТО';
    $('.voting-content>p').textContent = 'Голосование открыто. Подтверди участие и выбери своих легенд. Правила и сроки доступны на странице голосования.';
    $('.catalog-note').textContent = 'Шорт-лист — черновик. Для отправки перейди к голосованию.';
    $('.voting-small').textContent = 'Один голос в каждой номинации';
    $('.shortlist-explanation').textContent = 'Этот личный черновик сохранён в браузере и никуда не отправлен. Чтобы проголосовать, перейди к голосованию в соответствующем разделе.';
    $('.faq-list details:nth-child(2)>p').textContent = 'Голосование открыто. Перейди по кнопке в разделе «Один браток. Один голос». Окончательные правила и сроки указаны на странице голосования.';
    $('.faq-list details:nth-child(3)>p').textContent = 'Голосование проходит во внешнем сервисе. Порядок подтверждения участника и окончательные правила указаны на его странице. Сам сайт BRATKI голоса не принимает.';
  }
  const menuToggle = $('.menu-toggle');
  menuToggle.addEventListener('click', () => { const open = menuToggle.getAttribute('aria-expanded') === 'true'; menuToggle.setAttribute('aria-expanded', String(!open)); menuToggle.setAttribute('aria-label', open ? 'Открыть меню' : 'Закрыть меню'); $('#mobile-menu').hidden = open; });
  $('#mobile-menu').querySelectorAll('a').forEach(a => a.addEventListener('click', () => { $('#mobile-menu').hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', 'Открыть меню'); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#mobile-menu').hidden) { $('#mobile-menu').hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.focus(); } });
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); revealObserver.unobserve(entry.target); } });
  }, {threshold:.08});
  let animationEnabled = !reduceMotion.matches && !navigator.connection?.saveData;
  const canvas = $('#starfield');
  const ctx = canvas.getContext('2d');
  let stars = [], canvasWidth = 0, canvasHeight = 0, animationFrame = 0, lastFrame = 0;
  let pointerX = 0, pointerY = 0;
  function resizeStars() {
    canvasWidth = innerWidth; canvasHeight = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(canvasWidth * ratio); canvas.height = Math.round(canvasHeight * ratio);
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    let seed = 2026;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    stars = Array.from({length:canvasWidth < 780 ? 65 : 145}, () => ({x:random()*canvasWidth,y:random()*canvasHeight,r:.35+random()*.95,phase:random()*Math.PI*2,speed:.35+random()*.65,cross:random()>.955}));
    if (!animationEnabled) drawStars(0);
  }
  function drawStars(time) {
    if (!ctx) return;
    ctx.clearRect(0,0,canvasWidth,canvasHeight);
    const seconds = time / 1000;
    for (const star of stars) {
      const opacity = .2 + (Math.sin(seconds*star.speed+star.phase)+1)*.27;
      const x = star.x + (animationEnabled ? pointerX*star.r*5 : 0), y = star.y + (animationEnabled ? pointerY*star.r*5 : 0);
      ctx.fillStyle = `rgba(194,217,255,${opacity})`;
      ctx.beginPath(); ctx.arc(x,y,star.r,0,Math.PI*2); ctx.fill();
      if (star.cross) {
        ctx.strokeStyle = `rgba(205,225,255,${opacity*.65})`; ctx.lineWidth=.6;
        ctx.beginPath(); ctx.moveTo(x-4,y); ctx.lineTo(x+4,y); ctx.moveTo(x,y-4); ctx.lineTo(x,y+4); ctx.stroke();
      }
    }
    const comet = (seconds % 12) / 1.8;
    if (animationEnabled && comet < 1 && seconds > 1) {
      const x = canvasWidth*(.85-comet*.6), y = canvasHeight*(.1+comet*.45);
      const trail = ctx.createLinearGradient(x,y,x+110,y-75); trail.addColorStop(0,`rgba(209,230,255,${Math.sin(comet*Math.PI)*.65})`); trail.addColorStop(1,'rgba(209,230,255,0)');
      ctx.strokeStyle=trail;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+110,y-75);ctx.stroke();
    }
  }
  function animateStars(time) {
    if (!animationEnabled || document.hidden) { animationFrame=0; return; }
    if (time-lastFrame>32) { drawStars(time); lastFrame=time; }
    animationFrame=requestAnimationFrame(animateStars);
  }
  function setAnimation(enabled) {
    animationEnabled=enabled;
    document.body.classList.toggle('motion-paused',!enabled);
    $('#motion-toggle').setAttribute('aria-pressed',String(enabled));
    $('#motion-toggle').setAttribute('aria-label',enabled?'Остановить анимацию':'Включить анимацию');
    $('#motion-toggle').innerHTML=`<span aria-hidden="true">${enabled?'Ⅱ':'▷'}</span> Анимация`;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame=0;
    if (enabled && !document.hidden) animationFrame=requestAnimationFrame(animateStars); else drawStars(0);
  }
  $('#motion-toggle').addEventListener('click',()=>setAnimation(!animationEnabled));
  reduceMotion.addEventListener('change',event=>setAnimation(!event.matches && !navigator.connection?.saveData));
  window.addEventListener('resize',resizeStars,{passive:true});
  window.addEventListener('pointermove',event=>{ if (event.pointerType==='mouse') { pointerX=event.clientX/innerWidth-.5; pointerY=event.clientY/innerHeight-.5; } },{passive:true});
  document.addEventListener('visibilitychange',()=>{ if (document.hidden) { cancelAnimationFrame(animationFrame); animationFrame=0; } else if (animationEnabled && !animationFrame) animationFrame=requestAnimationFrame(animateStars); });
  const progress=$('.reading-progress');
  function updateProgress() { const height=document.documentElement.scrollHeight-innerHeight; progress.style.transform=`scaleX(${height>0?Math.min(scrollY/height,1):0})`; }
  window.addEventListener('scroll',updateProgress,{passive:true});
  const ticker = $('.ticker');
  const tickerTrack = $('.ticker-track');
  const tickerUnit = $('.ticker-unit').cloneNode(true);
  function fillTicker() {
    const group = el('div', 'ticker-group');
    group.append(tickerUnit.cloneNode(true));
    tickerTrack.replaceChildren(group);
    const unitWidth = group.getBoundingClientRect().width;
    if (!unitWidth) return;
    // Each identical half must cover the viewport for the entire animation cycle.
    const copies = Math.max(1, Math.ceil(ticker.clientWidth / unitWidth));
    for (let index = 1; index < copies; index++) group.append(tickerUnit.cloneNode(true));
    tickerTrack.append(group.cloneNode(true));
    tickerTrack.style.setProperty('--ticker-duration', `${group.getBoundingClientRect().width / 40}s`);
    ticker.classList.add('ticker-ready');
  }
  const tickerResizeObserver = new ResizeObserver(fillTicker);
  tickerResizeObserver.observe(ticker);
  document.fonts.ready.then(fillTicker);
  fillTicker();
  persist(); renderNominations(); resizeStars(); updateProgress();
  document.querySelectorAll('.reveal').forEach(node=>revealObserver.observe(node));
  document.body.classList.add('motion-ready'); setAnimation(animationEnabled);
})();
