import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

export async function openVotingDatabase({memory=false,adminKey}={}) {
  if (!memory) await mkdir(resolve(root,'.private'),{recursive:true});
  const db=new PGlite({dataDir:memory?'memory://':resolve(root,'.private/voting-dev'),extensions:{pgcrypto}});
  const installed=await db.query("select to_regclass('bratki_private.settings') is not null as installed");
  if (!installed.rows[0].installed) {
    await db.exec('create role anon; create role authenticated;');
    await db.exec(await readFile(resolve(root,'supabase/migrations/202611070001_voting.sql'),'utf8'));
    const key=adminKey||randomBytes(32).toString('base64url');
    await db.query('update bratki_private.settings set admin_hash=$1',[createHash('sha256').update(key).digest('hex')]);
    if (!memory) await writeFile(resolve(root,'.private/dev-admin.txt'),`Локальная проверка BRATKI — ключ организатора:\n${key}\n\nЭтот ключ не подходит для опубликованного сайта.\n`,{mode:0o600});
  }
  const extraInstalled=await db.query("select exists(select 1 from information_schema.columns where table_schema='bratki_private' and table_name='settings' and column_name='extra_status') as installed");
  if (!extraInstalled.rows[0].installed) await db.exec(await readFile(resolve(root,'supabase/migrations/202611100001_extra_nomination_vote.sql'),'utf8'));
  return db;
}

const methods={bratki_state:[],bratki_voter:['p_nick','p_code'],bratki_submit:['p_nick','p_code','p_choices'],bratki_submit_extras:['p_nick','p_code','p_choices'],bratki_admin:['p_key','p_action','p_payload']};
export async function callVotingRpc(db,name,payload={}) {
  if (!Object.hasOwn(methods,name)) throw new Error('BRATKI_UNKNOWN_ACTION');
  const keys=methods[name], values=keys.map(key=>key==='p_choices'||key==='p_payload'?JSON.stringify(payload[key]??{}):payload[key]??'');
  const placeholders=keys.map((key,index)=>`$${index+1}${key==='p_choices'||key==='p_payload'?'::jsonb':'::text'}`).join(',');
  return db.transaction(async transaction=>{
    await transaction.exec('set local role anon;');
    return (await transaction.query(`select public.${name}(${placeholders}) as data`,values)).rows[0].data;
  });
}
