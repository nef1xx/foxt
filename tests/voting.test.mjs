import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openVotingDatabase,callVotingRpc } from '../scripts/voting-local-db.mjs';

test('real PostgreSQL voting: permissions, setup, atomic ballots, privacy and published results',async t=>{
  const key='test-only-organizer-key-not-for-production';
  const db=await openVotingDatabase({memory:true,adminKey:key});
  const rpc=(name,payload)=>callVotingRpc(db,name,payload);
  const admin=(action,payload={})=>rpc('bratki_admin',{p_key:key,p_action:action,p_payload:payload});
  try {
    let dashboard,codes,ballot,enabled;
    await t.test('anonymous visitors cannot read private data or use admin actions',async()=>{
      await assert.rejects(rpc('bratki_admin',{p_key:'wrong',p_action:'dashboard'}),/BRATKI_ADMIN_DENIED/);
      await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select * from bratki_private.participants');}),/permission denied/);
      await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select * from bratki_private.tally');}),/permission denied/);
      const state=await rpc('bratki_state');assert.equal(state.status,'preparation');assert.equal(state.submitted,0);
    });
    await t.test('opening requires candidates, participants and exactly two extras',async()=>{
      await assert.rejects(admin('open'),/BRATKI_EXTRAS_FIRST/);
      dashboard=await admin('dashboard');
      dashboard.nominations=dashboard.nominations.map((n,i)=>({...n,enabled:n.type==='main'||i===4,candidates:['Кандидат А','Кандидат Б']}));
      await admin('configure',{nominations:dashboard.nominations});
      codes=(await admin('issue',{nicks:['Браток 1','Браток 2','Браток 3']})).codes;
      await admin('open_extras');
      await assert.rejects(admin('open'),/BRATKI_EXTRAS_FIRST/);
      await db.exec("update bratki_private.settings set extra_closes_at=clock_timestamp()-interval '1 second'");
      dashboard=await admin('dashboard');
      enabled=dashboard.nominations.filter(n=>n.enabled);
      ballot=Object.fromEntries(enabled.map(n=>[n.id,n.candidates[0].id]));
      await admin('open');assert.equal((await rpc('bratki_state')).nominations.length,6);
    });
    await t.test('codes bind to nicknames and only hashes are stored',async()=>{
      const stored=(await db.query('select code_hash from bratki_private.participants')).rows;
      assert(stored.every(row=>/^[a-f0-9]{64}$/.test(row.code_hash)));
      assert(!JSON.stringify(stored).includes(codes[0].code));
      await assert.rejects(rpc('bratki_voter',{p_nick:codes[1].nick,p_code:codes[0].code}),/BRATKI_INVALID_CODE/);
      const voter=await rpc('bratki_voter',{p_nick:'  БРАТОК   1 ',p_code:codes[0].code.toLowerCase().replaceAll('-',' ')});
      assert.equal(voter.nick,'Браток 1');assert.equal(voter.submitted,false);
    });
    await t.test('invalid, incomplete and cross-category ballots do not consume codes or count votes',async()=>{
      const credentials={p_nick:codes[0].nick,p_code:codes[0].code};
      await assert.rejects(rpc('bratki_submit',{...credentials,p_choices:{king:ballot.king}}),/BRATKI_INVALID_BALLOT/);
      await assert.rejects(rpc('bratki_submit',{...credentials,p_choices:{...ballot,king:ballot.positive}}),/BRATKI_INVALID_BALLOT/);
      await assert.rejects(rpc('bratki_submit',{...credentials,p_choices:{...ballot,unknown:ballot.king}}),/BRATKI_INVALID_BALLOT/);
      assert.equal((await rpc('bratki_voter',credentials)).submitted,false);
      assert.equal((await db.query('select sum(votes)::integer as votes from bratki_private.tally')).rows[0].votes,0);
    });
    await t.test('concurrent duplicate deliveries count exactly one complete ballot',async()=>{
      const payload={p_nick:codes[0].nick,p_code:codes[0].code,p_choices:ballot};
      const responses=await Promise.all([rpc('bratki_submit',payload),rpc('bratki_submit',payload)]);
      assert(responses.every(r=>r.accepted));assert.equal(responses.filter(r=>!r.alreadySubmitted).length,1);
      assert.equal((await rpc('bratki_state')).submitted,1);
      const tally=(await db.query('select votes from bratki_private.tally where votes>0')).rows;
      assert.equal(tally.length,6);assert(tally.every(r=>r.votes===1));
    });
    await t.test('choice data remains hidden and used codes cannot be reissued',async()=>{
      const state=await rpc('bratki_state');assert(!JSON.stringify(state.nominations).includes('votes'));
      dashboard=await admin('dashboard');assert(!JSON.stringify(dashboard.nominations).includes('votes'));
      assert.deepEqual(Object.keys(dashboard.participants[0]).sort(),['extraSubmitted','id','nick','submitted']);
      await assert.rejects(admin('reissue',{id:dashboard.participants.find(p=>p.submitted).id}),/BRATKI_CANNOT_REISSUE/);
      await assert.rejects(admin('configure',{nominations:dashboard.nominations}),/BRATKI_CONFIG_LOCKED/);
      await assert.rejects(admin('publish'),/BRATKI_CLOSE_FIRST/);
    });
    await t.test('reissuing an unused code invalidates the old one',async()=>{
      const person=dashboard.participants.find(p=>p.nick===codes[1].nick);
      const replacement=(await admin('reissue',{id:person.id})).codes[0];
      await assert.rejects(rpc('bratki_voter',{p_nick:codes[1].nick,p_code:codes[1].code}),/BRATKI_INVALID_CODE/);
      await rpc('bratki_submit',{p_nick:replacement.nick,p_code:replacement.code,p_choices:ballot});
      assert.equal((await rpc('bratki_state')).submitted,2);
    });
    await t.test('closing rejects new ballots; publication exposes only aggregate counts',async()=>{
      await admin('close');
      await assert.rejects(rpc('bratki_submit',{p_nick:codes[2].nick,p_code:codes[2].code,p_choices:ballot}),/BRATKI_NOT_OPEN/);
      assert(!JSON.stringify((await rpc('bratki_state')).nominations).includes('votes'));
      await admin('publish');const state=await rpc('bratki_state');
      assert.equal(state.status,'closed');assert.equal(state.resultsPublished,true);
      assert.equal(state.submitted,2);assert.equal(state.participants,3);
      state.nominations.forEach(n=>assert.equal(n.candidates.reduce((sum,c)=>sum+c.votes,0),2));
      const retry=await rpc('bratki_submit',{p_nick:codes[0].nick,p_code:codes[0].code,p_choices:ballot});assert.equal(retry.alreadySubmitted,true);
      const tables=(await db.query("select table_name from information_schema.tables where table_schema='bratki_private' order by table_name")).rows.map(r=>r.table_name);
      assert.deepEqual(tables,['candidates','extra_tally','nominations','participants','settings','tally']);
    });
  } finally { await db.close(); }
});

test('extra nomination stage: exact choices, deadline, retries, tie-break and independent ballots',async t=>{
 const key='test-stage-one-key';const db=await openVotingDatabase({memory:true,adminKey:key});
 const rpc=(name,payload)=>callVotingRpc(db,name,payload);
 const admin=(action,payload={})=>rpc('bratki_admin',{p_key:key,p_action:action,p_payload:payload});
 let codes,started,first;
 try {
  await t.test('private helpers and extra tally cannot be accessed as anon',async()=>{
   for(const query of ['select * from bratki_private.extra_tally','select bratki_private.candidate_admin(\'test-stage-one-key\',\'dashboard\')','select bratki_private.finish_extras()'])
    await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query(query);}),/permission denied/);
  });
  await t.test('only the organizer can start a single 72-hour round',async()=>{
   codes=(await admin('issue',{nicks:['Первый','Второй','Третий','Четвёртый']})).codes;
   first={p_nick:codes[0].nick,p_code:codes[0].code};
   await assert.rejects(rpc('bratki_submit_extras',{...first,p_choices:['delivery','wise']}),/BRATKI_EXTRAS_CLOSED/);
   await assert.rejects(rpc('bratki_admin',{p_key:'wrong',p_action:'open_extras'}),/BRATKI_ADMIN_DENIED/);
   started=await admin('open_extras');
   assert(Math.abs(new Date(started.extra.closesAt)-new Date(started.extra.startedAt)-72*3600000)<5);
   await assert.rejects(admin('open_extras'),/BRATKI_CONFIG_LOCKED/);
   assert.equal((await rpc('bratki_state')).extra.closesAt,started.extra.closesAt);
   await assert.rejects(admin('open'),/BRATKI_EXTRAS_FIRST/);
   await assert.rejects(rpc('bratki_submit',{...first,p_choices:{}}),/BRATKI_EXTRAS_FIRST/);
  });
  await t.test('exactly two distinct additional IDs are required; invalid choices consume nothing',async()=>{
   for(const choices of [null,{},[],['heart'],['heart','wise','funny'],['heart','heart'],['king','wise'],['missing','wise'],[1,'wise']])
    await assert.rejects(rpc('bratki_submit_extras',{...first,p_choices:choices}),/BRATKI_INVALID_EXTRAS/);
   assert.equal((await rpc('bratki_voter',first)).submitted,false);
   assert.equal((await db.query('select sum(votes)::int as sum from bratki_private.extra_tally')).rows[0].sum,0);
   await assert.rejects(rpc('bratki_submit_extras',{...first,p_nick:codes[1].nick,p_choices:['wise','heart']}),/BRATKI_INVALID_CODE/);
  });
  await t.test('duplicate deliveries count once and do not consume the second-stage ballot',async()=>{
   const responses=await Promise.all([rpc('bratki_submit_extras',{...first,p_choices:['heart','wise']}),rpc('bratki_submit_extras',{...first,p_choices:['heart','wise']})]);
   assert.equal(responses.filter(r=>!r.alreadySubmitted).length,1);
   const person=await rpc('bratki_voter',first);assert.equal(person.submitted,true);assert.equal(person.extraSubmitted,true);assert.equal(person.candidateSubmitted,false);
   const state=await rpc('bratki_state');assert.equal(state.extra.submitted,1);assert.equal(state.submitted,0);
   assert(state.extra.options.every(n=>!Object.hasOwn(n,'votes')));
   const dashboard=await admin('dashboard');assert(dashboard.extra.options.every(n=>!Object.hasOwn(n,'votes')));
   await assert.rejects(admin('reissue',{id:dashboard.participants.find(p=>p.nick===first.p_nick).id}),/BRATKI_CANNOT_REISSUE/);
   await rpc('bratki_submit_extras',{p_nick:codes[1].nick,p_code:codes[1].code,p_choices:['heart','funny']});
   const sum=(await db.query('select sum(votes)::int as sum from bratki_private.extra_tally')).rows[0].sum;assert.equal(sum,4);
  });
  await t.test('expired ballots are rejected even before any page refresh; winners finalize on read',async()=>{
   await db.exec("update bratki_private.settings set extra_closes_at=clock_timestamp()-interval '1 second'");
   await assert.rejects(rpc('bratki_submit_extras',{p_nick:codes[2].nick,p_code:codes[2].code,p_choices:['delivery','wise']}),/BRATKI_EXTRAS_CLOSED/);
   const state=await rpc('bratki_state');assert.equal(state.stage,'candidates');assert.equal(state.extra.status,'closed');assert.equal(state.status,'preparation');
   assert.deepEqual(state.extra.options.filter(n=>n.selected).map(n=>n.id),['funny','heart']);
   assert.deepEqual(state.extra.options.map(n=>n.votes),[0,1,2,1]);
   assert.equal(state.nominations.length,6);
   assert.equal((await rpc('bratki_voter',first)).submitted,false);
   const retry=await rpc('bratki_submit_extras',{...first,p_choices:['heart','wise']});assert.equal(retry.alreadySubmitted,true);
   await assert.rejects(admin('open_extras'),/BRATKI_CONFIG_LOCKED/);
  });
  await t.test('configuration cannot override winners; the original code casts a candidate ballot',async()=>{
   let dashboard=await admin('dashboard');
   const nominations=dashboard.nominations.map(n=>({...n,enabled:!n.enabled,candidates:['Кандидат 1','Кандидат 2']}));
   dashboard=await admin('configure',{nominations});assert.deepEqual(dashboard.nominations.filter(n=>n.type==='additional'&&n.enabled).map(n=>n.id),['funny','heart']);
   await admin('open');
   const ballot=Object.fromEntries(dashboard.nominations.filter(n=>n.enabled).map(n=>[n.id,n.candidates[0].id]));
   await rpc('bratki_submit',{...first,p_choices:ballot});
   const person=await rpc('bratki_voter',first);assert(person.extraSubmitted&&person.candidateSubmitted&&person.submitted);
   const state=await rpc('bratki_state');assert.equal(state.submitted,1);assert.equal(state.extra.submitted,2);
  });
 } finally {await db.close();}
});
