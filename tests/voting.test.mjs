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
      await assert.rejects(admin('open'),/BRATKI_NOT_READY/);
      dashboard=await admin('dashboard');
      dashboard.nominations=dashboard.nominations.map((n,i)=>({...n,enabled:n.type==='main'||i===4,candidates:['Кандидат А','Кандидат Б']}));
      await admin('configure',{nominations:dashboard.nominations});
      codes=(await admin('issue',{nicks:['Браток 1','Браток 2','Браток 3']})).codes;
      await assert.rejects(admin('open'),/BRATKI_NOT_READY/);
      dashboard.nominations[5].enabled=true;
      dashboard=await admin('configure',{nominations:dashboard.nominations});
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
      const state=await rpc('bratki_state');assert(!JSON.stringify(state).includes('votes'));
      dashboard=await admin('dashboard');assert(!JSON.stringify(dashboard).includes('votes'));
      assert.deepEqual(Object.keys(dashboard.participants[0]).sort(),['id','nick','submitted']);
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
      assert(!JSON.stringify(await rpc('bratki_state')).includes('votes'));
      await admin('publish');const state=await rpc('bratki_state');
      assert.equal(state.status,'closed');assert.equal(state.resultsPublished,true);
      assert.equal(state.submitted,2);assert.equal(state.participants,3);
      state.nominations.forEach(n=>assert.equal(n.candidates.reduce((sum,c)=>sum+c.votes,0),2));
      const retry=await rpc('bratki_submit',{p_nick:codes[0].nick,p_code:codes[0].code,p_choices:ballot});assert.equal(retry.alreadySubmitted,true);
      const tables=(await db.query("select table_name from information_schema.tables where table_schema='bratki_private' order by table_name")).rows.map(r=>r.table_name);
      assert.deepEqual(tables,['candidates','nominations','participants','settings','tally']);
    });
  } finally { await db.close(); }
});
