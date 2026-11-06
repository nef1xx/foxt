(() => {
 'use strict';
 const {configured,rpc,el,renderResults,download}=window.BratkiVoting;
 const $=selector=>document.querySelector(selector);
 let key='',dashboard=null,issuedCodes=[],working=false;
 function message(id,text) { $(id).textContent=text||'';$(id).hidden=!text; }
 async function run(action) {
  if(working)return;working=true;message('#admin-error','');message('#admin-notice','');
  const buttons=Array.from(document.querySelectorAll('button')).filter(b=>!b.disabled);buttons.forEach(b=>b.disabled=true);
  try {await action();}catch(e){message('#admin-error',e.message);$('#admin-error').scrollIntoView({block:'center'});}
  finally {working=false;buttons.forEach(b=>b.disabled=false);}
 }
 const request=(action,payload={})=>rpc('bratki_admin',{p_key:key,p_action:action,p_payload:payload});
 function confirmation(title,copy) {
  $('#confirm-title').textContent=title;$('#confirm-copy').textContent=copy;
  const dialog=$('#admin-confirm'),focused=document.activeElement;dialog.returnValue='';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>{focused?.focus();resolve(dialog.returnValue==='yes');},{once:true}));
 }
 $('#confirm-cancel').addEventListener('click',()=>$('#admin-confirm').close('no'));
 $('#confirm-accept').addEventListener('click',()=>$('#admin-confirm').close('yes'));
 function countExtras() { const count=document.querySelectorAll('[data-extra]:checked').length;$('#extra-count').textContent=`Выбрано дополнительных: ${count} из 2`;$ ('#extra-count').classList.toggle('invalid-count',count!==2); }
 function render() {
  $('#admin-login').hidden=true;$('#admin-dashboard').hidden=false;
  $('#admin-status').textContent={preparation:'ПОДГОТОВКА',open:'ГОЛОСОВАНИЕ ОТКРЫТО',closed:'ГОЛОСОВАНИЕ ЗАКРЫТО'}[dashboard.status];
  const submitted=dashboard.participants.filter(p=>p.submitted).length;
  $('#stat-total').textContent=dashboard.participants.length;$('#stat-submitted').textContent=submitted;$('#stat-pending').textContent=dashboard.participants.length-submitted;
  $('#configuration-section').hidden=dashboard.status!=='preparation';$('#issue-section').hidden=dashboard.status!=='preparation';
  $('#open-election').hidden=dashboard.status!=='preparation';$('#close-election').hidden=dashboard.status!=='open';$('#publish-results').hidden=dashboard.status!=='closed'||dashboard.resultsPublished;
  if(dashboard.status==='preparation') {
   const editors=$('#candidate-editors');editors.replaceChildren();
   dashboard.nominations.forEach(n=>{
    const editor=el('div','candidate-editor');editor.dataset.category=n.id;editor.append(el('h3','',n.title));
    const checkLabel=el('label','check-line'),check=el('input');check.type='checkbox';check.checked=n.enabled;check.disabled=n.type==='main';check.name='enabled';if(n.type==='additional')check.dataset.extra='true';check.addEventListener('change',countExtras);
    checkLabel.append(check,el('span','',n.type==='main'?'Основная · обязательно в голосовании':'Включить в голосование'));editor.append(checkLabel);
    const label=el('label','editor-label','Кандидаты — по одному в строке'),textarea=el('textarea');textarea.id=`candidates-${n.id}`;textarea.name=n.id;textarea.rows=5;textarea.value=n.candidates.map(c=>c.label).join('\n');label.htmlFor=textarea.id;
    editor.append(label,textarea);editors.append(editor);
   });countExtras();
  }
  const rows=$('#attendance-rows');rows.replaceChildren();
  dashboard.participants.forEach(p=>{
   const row=el('tr'),status=el('td'),codeCell=el('td');row.append(el('td','',p.nick));status.append(el('span',`participation-status${p.submitted?' submitted':''}`,p.submitted?'✓ Проголосовал':'Ожидаем'));row.append(status);
   if(!p.submitted&&dashboard.status!=='closed') { const button=el('button','quiet-button','Перевыпустить');button.type='button';button.setAttribute('aria-label',`Перевыпустить код: ${p.nick}`);button.addEventListener('click',async()=>{
    if(!await confirmation('Выдать новый код?',`Старый код для «${p.nick}» сразу перестанет действовать. Новый нужно отправить участнику.`))return;
    await run(async()=>{showCodes((await request('reissue',{id:p.id})).codes);});
   });codeCell.append(button); } else codeCell.textContent=p.submitted?'Использован':'Голосование закрыто';
   row.append(codeCell);rows.append(row);
  });
  if(!dashboard.participants.length){const row=el('tr'),cell=el('td','','Пока нет участников. Добавь ники и выдай личные коды.');cell.colSpan=3;row.append(cell);rows.append(row);}
  $('#admin-results-section').hidden=dashboard.status!=='closed';
  if(dashboard.status==='closed'){renderResults($('#admin-results-content'),dashboard.nominations);$('#admin-results-note').textContent=dashboard.resultsPublished?'Итоги опубликованы на странице голосования.':'Итоги пока видны только организатору. Нажми «Опубликовать итоги», чтобы открыть их участникам.';}
 }
 function showCodes(codes) {
  // Keep all newly issued codes until the organizer downloads or leaves the page.
  codes.forEach(code=>{issuedCodes=issuedCodes.filter(c=>c.nick!==code.nick);issuedCodes.push(code);});
  $('#issued-codes').hidden=false;const list=$('#code-list');list.replaceChildren();issuedCodes.forEach(c=>{const item=el('li');item.append(el('strong','',c.nick),el('code','',c.code));list.append(item);});
  $('#issued-codes').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 }
 $('#admin-login').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  if(!configured)throw new Error('Сервер голосования ещё не подключён. Доступ к панели появится после настройки Supabase.');
  const enteredKey=$('#admin-key').value.trim();
  try {key=enteredKey;dashboard=await request('dashboard');$('#admin-key').value='';render();}catch(e){key='';throw e;}
 });});
 $('#admin-logout').addEventListener('click',()=>{key='';dashboard=null;issuedCodes=[];$('#code-list').replaceChildren();$('#issued-codes').hidden=true;$('#admin-dashboard').hidden=true;$('#admin-login').hidden=false;message('#admin-error','');message('#admin-notice','');$('#admin-key').focus();});
 $('#admin-refresh').addEventListener('click',()=>run(async()=>{dashboard=await request('dashboard');render();}));
 $('#configuration-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const nominations=Array.from(document.querySelectorAll('[data-category]')).map(editor=>({id:editor.dataset.category,enabled:editor.querySelector('input').checked,candidates:editor.querySelector('textarea').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)}));
  if(nominations.filter(n=>n.enabled&&dashboard.nominations.find(d=>d.id===n.id).type==='additional').length!==2)throw new Error('Выбери ровно две дополнительные номинации.');
  dashboard=await request('configure',{nominations});render();message('#admin-notice','Состав бюллетеня сохранён.');
 });});
 $('#issue-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const nicks=$('#participant-nicks').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);const result=await request('issue',{nicks});
  showCodes(result.codes);$('#participant-nicks').value='';dashboard=await request('dashboard');render();message('#admin-notice','Личные коды выданы. Сохрани список и отправь каждому только его код.');
 });});
 $('#download-codes').addEventListener('click',()=>download('BRATKI-2026-private-codes.txt',['BRATKI 2026 — ЛИЧНЫЕ КОДЫ','Не публиковать. Каждому участнику отправить только его строку.','',...issuedCodes.map(c=>`${c.nick}: ${c.code}`)].join('\r\n')));
 $('#download-attendance').addEventListener('click',()=>download('BRATKI-2026-attendance.txt',['BRATKI 2026 — ЯВКА','',...dashboard.participants.map(p=>`${p.nick}: ${p.submitted?'проголосовал':'не проголосовал'}`)].join('\r\n')));
 const transitions=[['open-election','open','Открыть голосование?','Проверь сохранённый состав и список участников. После открытия кандидатов, номинации и состав участников изменить нельзя.'],['close-election','close','Завершить голосование?','Новые бюллетени больше не будут приниматься. Повторно открыть этот сезон из панели нельзя. Итоги пока останутся закрытыми.'],['publish-results','publish','Опубликовать итоги?','Общие результаты станут видны всем на странице голосования. Имена проголосовавших остаются в панели организатора.']];
 transitions.forEach(([id,action,title,copy])=>$('#'+id).addEventListener('click',async()=>{if(!await confirmation(title,copy))return;run(async()=>{dashboard=await request(action);render();message('#admin-notice',{open:'Голосование открыто. Можно отправлять участникам ссылку.',close:'Голосование закрыто. Итоги можно проверить и опубликовать.',publish:'Итоги опубликованы.'}[action]);});}));
 if(!configured)message('#admin-error','Сервер голосования ещё не подключён. Панель подготовлена; запуск станет доступен после настройки Supabase.');
})();
