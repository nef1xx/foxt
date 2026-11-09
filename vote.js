(() => {
 'use strict';
 const {configured,rpc,el,renderResults,countdown,renderExtras}=window.BratkiVoting;
 const $=selector=>document.querySelector(selector);
 let election=null,person=null,code='',choices={},ballotStage=null,stopCountdown=()=>{},loading=false,sending=false;
 const isExtras=()=>election?.stage==='extras';
 const isOpen=()=>isExtras()?election.extra.status==='open':election?.status==='open';
 function error(id,message) { const node=$(id);node.textContent=message||'';node.hidden=!message; }
 function focusHeading(section) { const heading=section.querySelector('h2');heading.tabIndex=-1;heading.focus();section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); }
 function step(name) {
  ['identity','ballot','review'].forEach(s=>{ $(`#${s}-section`).hidden=s!==name; const node=$(`#step-${s}`);if(s===name)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current'); });
 }
 function busy(button,value,label) { button.disabled=value;button.textContent=value?'Подожди…':label; }
 function accepted(already=false) {
  ['identity-section','ballot-section','review-section','vote-steps','availability'].forEach(id=>$(`#${id}`).hidden=true);
  $('#success-section').hidden=false;
  $('#success-copy').textContent=already?`${person.nick}, твой голос на этом этапе уже был принят. Повторно он не учитывается.`:`${person.nick}, твой голос принят. Твой выбор рядом с ником не показывается.`;
  $('#success-next').textContent=ballotStage==='extras'?'Ты выбрал дополнительные номинации. Итоги появятся после окончания таймера. Сохрани личный код: он понадобится для голосования за кандидатов.':'Итоги появятся здесь после закрытия голосования и публикации организатором.';
  code='';choices={};$('#voter-code').value='';$('#ballot-fields').replaceChildren();$('#review-list').replaceChildren();
  focusHeading($('#success-section'));
 }
 async function loadState() {
  if(loading||sending)return;loading=true;
  error('#page-error','');busy($('#refresh-state'),true,'Обновить ↻');
  try {
   if(!configured) {
    $('#election-status').textContent='ГОТОВИТСЯ';$('#availability').hidden=false;$('#availability-title').textContent='Голосование готовится';
    $('#availability-copy').textContent='Скоро здесь можно будет проголосовать по нику и личному коду. Организатор сообщит о старте.';return;
   }
   const current=await rpc('bratki_state');
   if(election&&current.stage!==election.stage){person=null;code='';choices={};ballotStage=null;step('identity');$('#success-section').hidden=true;$('#ballot-fields').replaceChildren();$('#review-list').replaceChildren();$('#voter-code').value='';}
   election=current;
   stopCountdown();stopCountdown=countdown($('#extra-countdown'),election.extra,()=>{setTimeout(loadState,50);});
   renderExtras($('#extra-results'),election.extra);
   $('#vote-phase').textContent=isExtras()?'ЭТАП 01 / ДОПОЛНИТЕЛЬНЫЕ НОМИНАЦИИ':'ЭТАП 02 / ГОЛОСОВАНИЕ ЗА КАНДИДАТОВ';
   $('#vote-heading-copy').textContent=isExtras()?'Сначала выберем две номинации из четырёх. Затем проголосуем за кандидатов — с тем же личным кодом.':'Четыре основные и две выбранные вами дополнительные номинации. По одному кандидату в каждой.';
   $('#election-status').textContent=isExtras()?(election.extra.status==='open'?'ВЫБИРАЕМ 2 ИЗ 4':'ПЕРВЫЙ ЭТАП ГОТОВИТСЯ'):{preparation:'ВТОРОЙ ЭТАП ГОТОВИТСЯ',open:'ГОЛОСОВАНИЕ ОТКРЫТО',closed:'ГОЛОСОВАНИЕ ЗАКРЫТО'}[election.status];
   $('#turnout').hidden=false;$('#turnout').textContent=`Участвовали ${isExtras()?election.extra.submitted:election.submitted} из ${election.participants}`;
   $('#results-section').hidden=!election.resultsPublished;
   if(election.resultsPublished)renderResults($('#results-content'),election.nominations);
   if(isOpen()) {
    $('#availability').hidden=true;
    if(!person) { $('#identity-section').hidden=false;$('#vote-steps').hidden=false; }
   } else {
    person=null;code='';choices={};$('#voter-code').value='';['identity-section','ballot-section','review-section','vote-steps'].forEach(id=>$('#'+id).hidden=true);$('#availability').hidden=false;
    $('#availability-title').textContent=election.status==='closed'?'Голосование завершено':'Голосование готовится';
    $('#availability-copy').textContent=election.status==='closed'?(election.resultsPublished?'Итоги опубликованы ниже. Спасибо каждому, кто участвовал.':'Бюллетени больше не принимаются. Организатор готовит публикацию итогов.'):isExtras()?'Первым откроется выбор двух дополнительных номинаций на три дня. Для участия понадобится ник и личный код от организатора.':'Дополнительные номинации выбраны — итоги первого этапа ниже. Организатор готовит кандидатов. Для второго этапа подойдёт тот же личный код.';
   }
  } catch(e) { error('#page-error',e.message); }
  finally { loading=false;busy($('#refresh-state'),false,'Обновить ↻'); }
 }
 $('#refresh-state').addEventListener('click',loadState);
 $('#show-code').addEventListener('click',()=>{const visible=$('#voter-code').type==='password';$('#voter-code').type=visible?'text':'password';$('#show-code').textContent=visible?'Скрыть':'Показать';$('#show-code').setAttribute('aria-pressed',String(visible));});
 $('#identity-form').addEventListener('submit',async event=>{
  event.preventDefault();error('#identity-error','');busy($('#identity-submit'),true,'Перейти к выбору ↗');
  const nick=$('#voter-nick').value.trim(), enteredCode=$('#voter-code').value.trim();
  try {
   const current=await rpc('bratki_state');election=current;
   if(!isOpen()){await loadState();return;}
   ballotStage=election.stage||'candidates';
   const voter=await rpc('bratki_voter',{p_nick:nick,p_code:enteredCode});
   person=voter;code=enteredCode;
   if(voter.submitted) { accepted(true);return; }
   $('#ballot-title').textContent=isExtras()?'Какие две — в финал?':'Выбирай своих.';
   $('#ballot-person').textContent=isExtras()?`${person.nick} · выбери ровно 2 номинации из 4`:`${person.nick} · по одному кандидату в каждой из ${election.nominations.length} номинаций`;
   const fields=$('#ballot-fields');fields.replaceChildren();
   $('#extra-selection-count').hidden=true;
   if(isExtras()) {
    choices=[];const field=el('fieldset','extra-ballot'),legend=el('legend','','Две дополнительные номинации');field.append(legend);
    const options=el('div','extra-options');
    election.extra.options.forEach((nomination,index)=>{
     const label=el('label','extra-option'),input=el('input');input.type='checkbox';input.name='extra';input.value=nomination.id;input.setAttribute('aria-describedby','extra-selection-count');
     const art=el('img');art.src=`./assets/cosmic/${nomination.id}.webp`;art.alt='';art.width=320;art.height=180;
     const text=el('span','extra-option-copy');text.append(el('small','',`0${index+1} / ДОПОЛНИТЕЛЬНАЯ`),el('strong','',nomination.title),el('span','',window.BRATKI?.nominations.find(n=>n.id===nomination.id)?.description||''));
     input.addEventListener('change',()=>{const checked=[...options.querySelectorAll('input:checked')];if(checked.length>2){input.checked=false;error('#ballot-error','Уже выбраны две номинации. Сними одну отметку, чтобы заменить выбор.');}else error('#ballot-error','');$('#extra-selection-count').textContent=`Выбрано ${options.querySelectorAll('input:checked').length} из 2`;});
     label.append(input,art,text);options.append(label);
    });field.append(options,el('p','field-hint','При равенстве голосов выше номинация, которая раньше в этом списке.'));fields.append(field);$('#extra-selection-count').hidden=false;$('#extra-selection-count').textContent='Выбрано 0 из 2';
   } else election.nominations.forEach((nomination,index)=>{
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
  event.preventDefault();error('#ballot-error','');
  choices=isExtras()?new FormData(event.currentTarget).getAll('extra'):Object.fromEntries(new FormData(event.currentTarget));
  if(isExtras()&&choices.length!==2){error('#ballot-error','Выбери ровно две дополнительные номинации.');return;}
  const review=$('#review-list');review.replaceChildren();
  if(isExtras())choices.forEach((id,index)=>review.append(el('dt','',`Дополнительная номинация ${index+1}`),el('dd','',election.extra.options.find(n=>n.id===id).title)));
  else for(const n of election.nominations) { const candidate=n.candidates.find(c=>c.id===choices[n.id]);if(!candidate){error('#ballot-error','Выбери одного кандидата в каждой номинации.');return;}review.append(el('dt','',n.title),el('dd','',candidate.label)); }
  $('#confirm-ballot').checked=false;step('review');focusHeading($('#review-section'));
 });
 $('#back-to-ballot').addEventListener('click',()=>{step('ballot');focusHeading($('#ballot-section'));});
 $('#submit-form').addEventListener('submit',async event=>{
  event.preventDefault();if(sending)return;sending=true;error('#submit-error','');busy($('#submit-ballot'),true,'Отправить голос ✦');$('#back-to-ballot').disabled=true;
  try { const response=await rpc(ballotStage==='extras'?'bratki_submit_extras':'bratki_submit',{p_nick:person.nick,p_code:code,p_choices:choices});if(response.accepted){accepted(response.alreadySubmitted);sending=false;await loadState();}else throw new Error('Сервер не подтвердил приём. Повтори отправку.'); }
  catch(e){error('#submit-error',e.message);}
  finally {sending=false;busy($('#submit-ballot'),false,'Отправить голос ✦');$('#back-to-ballot').disabled=false;}
 });
 loadState();
 setInterval(()=>{if(!document.hidden)loadState();},30000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadState();});
})();
