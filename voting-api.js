(() => {
  'use strict';
  const settings = window.BRATKI_VOTING || {};
  const messages = {
    BRATKI_INVALID_CODE: 'Ник или личный код не совпали. Проверь их по сообщению организатора.',
    BRATKI_ADMIN_DENIED: 'Ключ организатора не подошёл.',
    BRATKI_NOT_OPEN: 'Голосование сейчас закрыто. Бюллетень не отправлен.',
    BRATKI_INVALID_BALLOT: 'Состав бюллетеня изменился. Обнови страницу и выбери кандидатов заново.',
    BRATKI_CONFIG_LOCKED: 'После открытия состав голосования изменить нельзя.',
    BRATKI_INVALID_CONFIG: 'Проверь кандидатов: до 100 имён в каждой номинации, до 80 символов в имени.',
    BRATKI_INVALID_NICKS: 'Укажи от 1 до 500 ников, по одному в строке. Ник — до 60 символов.',
    BRATKI_DUPLICATE_NICK: 'Один из ников уже есть в списке. Убери повтор и попробуй ещё раз.',
    BRATKI_DUPLICATE_NAME: 'Ники участников и имена внутри одной номинации не должны повторяться.',
    BRATKI_CANNOT_REISSUE: 'Новый код можно выдать только тому, кто ещё не проголосовал.',
    BRATKI_NOT_READY: 'Выбери ровно две дополнительные номинации, добавь хотя бы двух кандидатов в каждую активную номинацию и выдай коды участникам.',
    BRATKI_CLOSE_FIRST: 'Сначала закрой голосование. Затем можно опубликовать итоги.',
  };
  const configured = Boolean(settings.apiUrl && settings.publishableKey);
  async function rpc(name, payload = {}) {
    if (!configured) throw new Error('Приём голосов ещё не подключён. Организатор сообщит, когда можно будет голосовать.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${settings.apiUrl.replace(/\/$/, '')}/${name}`, {
        method: 'POST', headers: {'Content-Type':'application/json', apikey:settings.publishableKey},
        body: JSON.stringify(payload), signal:controller.signal, cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = messages[body?.message];
        throw new Error(message || 'Сервис голосования временно недоступен. Попробуй позже — введённые данные сохранены на этой странице.');
      }
      return body;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Не удалось получить ответ сервера. Проверь интернет и повтори отправку: второй голос с того же кода не засчитается.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function el(tag, className, text) { const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node; }
  function renderResults(root, nominations) {
    root.replaceChildren();
    for (const nomination of nominations.filter(n => n.enabled)) {
      const section=el('section','result-category');section.append(el('h3','',nomination.title));
      const candidates=[...nomination.candidates].sort((a,b)=>b.votes-a.votes);
      const total=candidates.reduce((sum,c)=>sum+c.votes,0), highest=candidates[0]?.votes||0;
      candidates.forEach(candidate=>{
        const row=el('div','result-row'), heading=el('div','result-row-heading');
        heading.append(el('span','',candidate.label),el('span','',`${candidate.votes} · ${total?Math.round(candidate.votes/total*100):0}%`));
        const bar=el('div','result-bar'), fill=el('span');fill.style.width=`${total?candidate.votes/total*100:0}%`;bar.append(fill);row.append(heading,bar);
        if(highest>0&&candidate.votes===highest)row.classList.add('result-leader');section.append(row);
      });
      if(highest>0&&candidates.filter(c=>c.votes===highest).length>1)section.append(el('p','muted-copy','Первое место разделили несколько кандидатов.'));
      root.append(section);
    }
  }
  function download(name,text) { const url=URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/plain;charset=utf-8'}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  window.BratkiVoting={configured,rpc,el,renderResults,download};
})();
