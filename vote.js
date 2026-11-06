(() => {
 'use strict';
 const {configured,rpc,el,renderResults}=window.BratkiVoting;
 const $=selector=>document.querySelector(selector);
 let election=null,person=null,code='',choices={};
 function error(id,message) { const node=$(id);node.textContent=message||'';node.hidden=!message; }
 function focusHeading(section) { const heading=section.querySelector('h2');heading.tabIndex=-1;heading.focus();section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); }
 function step(name) {
  ['identity','ballot','review'].forEach(s=>{ $(`#${s}-section`).hidden=s!==name; const node=$(`#step-${s}`);if(s===name)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current'); });
 }
 function busy(button,value,label) { button.disabled=value;button.textContent=value?'Подожди…':label; }
 function accepted(already=false) {
  ['identity-section','ballot-section','review-section','vote-steps','availability'].forEach(id=>$(`#${id}`).hidden=true);
  $('#success-section').hidden=false;
  $('#success-copy').textContent=already?`${person.nick}, твой бюллетень уже был принят. Повторно он не учитывается.`:`${person.nick}, твой бюллетень принят. Организатор видит отметку об участии, а твой выбор рядом с ником не показывается.`;
  code='';choices={};$('#voter-code').value='';$('#ballot-fields').replaceChildren();$('#review-list').replaceChildren();
  focusHeading($('#success-section'));
 }
 async function loadState() {
  error('#page-error','');busy($('#refresh-state'),true,'Обновить ↻');
  try {
   if(!configured) {
    $('#election-status').textContent='ГОТОВИТСЯ';$('#availability').hidden=false;$('#availability-title').textContent='Голосование готовится';
    $('#availability-copy').textContent='Скоро здесь можно будет проголосовать по нику и личному коду. Организатор сообщит о старте.';return;
   }
   election=await rpc('bratki_state');
   $('#election-status').textContent={preparation:'ГОТОВИТСЯ',open:'ГОЛОСОВАНИЕ ОТКРЫТО',closed:'ГОЛОСОВАНИЕ ЗАКРЫТО'}[election.status];
   $('#turnout').hidden=false;$('#turnout').textContent=`Участвовали ${election.submitted} из ${election.participants}`;
   $('#results-section').hidden=!election.resultsPublished;
   if(election.resultsPublished)renderResults($('#results-content'),election.nominations);
   if(election.status==='open') {
    $('#availability').hidden=true;
    if(!person) { $('#identity-section').hidden=false;$('#vote-steps').hidden=false; }
   } else {
    if(!person) { $('#identity-section').hidden=true;$('#vote-steps').hidden=true;$('#availability').hidden=false; }
    $('#availability-title').textContent=election.status==='closed'?'Голосование завершено':'Голосование готовится';
    $('#availability-copy').textContent=election.status==='closed'?(election.resultsPublished?'Итоги опубликованы ниже. Спасибо каждому, кто участвовал.':'Бюллетени больше не принимаются. Организатор готовит публикацию итогов.'):'Организатор готовит список кандидатов и личные коды. Приём голосов начнётся после объявления.';
   }
  } catch(e) { error('#page-error',e.message); }
  finally { busy($('#refresh-state'),false,'Обновить ↻'); }
 }
 $('#refresh-state').addEventListener('click',loadState);
 $('#show-code').addEventListener('click',()=>{const visible=$('#voter-code').type==='password';$('#voter-code').type=visible?'text':'password';$('#show-code').textContent=visible?'Скрыть':'Показать';$('#show-code').setAttribute('aria-pressed',String(visible));});
 $('#identity-form').addEventListener('submit',async event=>{
  event.preventDefault();error('#identity-error','');busy($('#identity-submit'),true,'Перейти к выбору ↗');
  const nick=$('#voter-nick').value.trim(), enteredCode=$('#voter-code').value.trim();
  try {
   const voter=await rpc('bratki_voter',{p_nick:nick,p_code:enteredCode});
   person=voter;code=enteredCode;
   if(voter.submitted) { accepted(true);return; }
   const current=await rpc('bratki_state');if(current.status!=='open') { person=null;code='';await loadState();return; }election=current;
   $('#ballot-person').textContent=`${person.nick} · по одному кандидату в каждой из ${election.nominations.length} номинаций`;
   const fields=$('#ballot-fields');fields.replaceChildren();
   election.nominations.forEach((nomination,index)=>{
    const field=el('fieldset','ballot-category'), legend=el('legend','',`${String(index+1).padStart(2,'0')} / ${nomination.title}`);field.append(legend);
    const options=el('div','candidate-options');
    nomination.candidates.forEach(candidate=>{
     const label=el('label','candidate-option'), input=el('input');input.type='radio';input.name=nomination.id;input.value=candidate.id;input.required=true;input.checked=choices[nomination.id]===candidate.id;
     label.append(input,el('span','',candidate.label));options.append(label);
    });field.append(options);fields.append(field);
   });step('ballot');focusHeading($('#ballot-section'));
  } catch(e) { person=null;code='';error('#identity-error',e.message); }
  finally { busy($('#identity-submit'),false,'Перейти к выбору ↗'); }
 });
 $('#change-person').addEventListener('click',()=>{person=null;code='';choices={};$('#voter-code').value='';step('identity');$('#voter-nick').focus();});
 $('#ballot-form').addEventListener('submit',event=>{
  event.preventDefault();choices=Object.fromEntries(new FormData(event.currentTarget));
  const review=$('#review-list');review.replaceChildren();
  for(const n of election.nominations) { const candidate=n.candidates.find(c=>c.id===choices[n.id]);if(!candidate){error('#ballot-error','Выбери одного кандидата в каждой номинации.');return;}review.append(el('dt','',n.title),el('dd','',candidate.label)); }
  $('#confirm-ballot').checked=false;step('review');focusHeading($('#review-section'));
 });
 $('#back-to-ballot').addEventListener('click',()=>{step('ballot');focusHeading($('#ballot-section'));});
 $('#submit-form').addEventListener('submit',async event=>{
  event.preventDefault();error('#submit-error','');busy($('#submit-ballot'),true,'Отправить голос ✦');$('#back-to-ballot').disabled=true;
  try { const response=await rpc('bratki_submit',{p_nick:person.nick,p_code:code,p_choices:choices});if(response.accepted){accepted(response.alreadySubmitted);await loadState();}else throw new Error('Сервер не подтвердил приём. Повтори отправку.'); }
  catch(e){error('#submit-error',e.message);}
  finally {busy($('#submit-ballot'),false,'Отправить голос ✦');$('#back-to-ballot').disabled=false;}
 });
 loadState();
})();
