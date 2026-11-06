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
  let expanded = false;
  let currentNomination = null;
  let toastTimer;
  const grid = $('#nomination-grid');
  const heroVideo = $('#hero-video');
  const filmVideo = $('#film-video');
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
    dialog.addEventListener('close', () => { if (![...dialogs].some(d => d.open)) { document.body.style.overflow = ''; const focusTarget = lastFocus?.isConnected && !lastFocus.closest('dialog:not([open])') ? lastFocus : $('[data-open-shortlist]'); focusTarget?.focus({preventScroll:true}); } if (dialog.id === 'film-dialog') filmVideo.pause(); });
  });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  function renderNominations() {
    const matching = nominations.filter(n => filter === 'all' || n.type === filter);
    const visible = filter === 'all' && !expanded ? matching.slice(0, 6) : matching;
    grid.replaceChildren();
    visible.forEach(n => {
      const index = nominations.indexOf(n) + 1;
      const selected = shortlist[n.id];
      const card = el('button', `nomination-card${n.id === 'king' ? ' featured' : ''}${selected ? ' selected' : ''}`);
      card.type = 'button'; card.dataset.nomination = n.id;
      card.setAttribute('aria-label', `${n.title}${selected ? ', в шорт-листе' : ''}. Открыть номинацию`);
      card.innerHTML = `<div class="card-top"><span class="card-index">${String(index).padStart(2, '0')} / 12</span><span class="card-tag ${n.type === 'new' ? 'new' : ''}">${selected ? '<span class="selected-label">✓ В ШОРТ-ЛИСТЕ</span>' : n.tag.toUpperCase()}</span></div><div class="card-symbol">${icon(n.icon)}</div><div class="card-body"><h3>${n.title}</h3><p>${n.description}</p><span class="card-arrow" aria-hidden="true">${selected ? '✓' : '↗'}</span></div>`;
      card.addEventListener('click', () => openNomination(n));
      grid.append(card);
    });
    $('#show-all').hidden = filter !== 'all';
    $('#show-all').style.display = filter === 'all' ? '' : 'none';
    $('#show-all').innerHTML = expanded ? 'Свернуть до 6 <span aria-hidden="true">↑</span>' : 'Все 12 номинаций <span aria-hidden="true">↓</span>';
  }
  function openNomination(n) {
    currentNomination = n;
    const saved = shortlist[n.id];
    $('#nomination-label').textContent = n.label || `${n.type === 'new' ? 'НОВАЯ НОМИНАЦИЯ' : 'КЛАССИКА BRATKI'} / 2026`;
    $('#nomination-title').textContent = n.title;
    $('#nomination-dialog').setAttribute('aria-labelledby', 'nomination-title');
    $('#nomination-description').textContent = n.criteria;
    $('#nomination-symbol').innerHTML = icon(n.icon);
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
  $('#show-all').addEventListener('click', () => { expanded = !expanded; renderNominations(); if (!expanded) $('#nominations').scrollIntoView({block:'start'}); $('#show-all').focus({preventScroll:true}); });
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
  let animationEnabled = false;
  async function setAnimation(enabled) {
    animationEnabled = enabled;
    $('.hero-media').classList.toggle('motion-enabled', enabled);
    if (enabled) { try { await heroVideo.play(); } catch { animationEnabled = false; } }
    else heroVideo.pause();
    $('#motion-toggle').setAttribute('aria-pressed', String(animationEnabled));
    $('#motion-toggle').setAttribute('aria-label', animationEnabled ? 'Остановить анимацию фона' : 'Включить анимацию фона');
    $('#motion-toggle').innerHTML = animationEnabled ? 'Ⅱ <span>Пауза</span>' : '▶ <span>Анимация</span>';
  }
  $('#motion-toggle').addEventListener('click', () => setAnimation(!animationEnabled));
  reduceMotion.addEventListener('change', event => { if (event.matches) setAnimation(false); });
  $('#play-film').addEventListener('click', async () => { openDialog($('#film-dialog')); filmVideo.currentTime = 0; try { await filmVideo.play(); } catch { /* Native video controls remain available. */ } });
  filmVideo.addEventListener('error', () => toast('Видео не загрузилось. Проверь подключение и попробуй ещё раз.'));
  new IntersectionObserver(entries => { for (const entry of entries) { if (!entry.isIntersecting) heroVideo.pause(); else if (animationEnabled) heroVideo.play().catch(() => {}); } }, {threshold:.05}).observe($('.hero'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) heroVideo.pause(); else if (animationEnabled) heroVideo.play().catch(() => {}); });
  persist(); renderNominations();
  if (!reduceMotion.matches && !navigator.connection?.saveData) setAnimation(true);
})();
