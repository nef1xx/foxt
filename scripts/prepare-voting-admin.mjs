import { randomBytes,createHash } from 'node:crypto';
import { mkdir,writeFile,access } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory=resolve('.private');await mkdir(directory,{recursive:true});
const output=resolve(directory,'production-admin.txt');
try{await access(output);throw new Error('A production organizer key already exists. Reuse .private/production-admin.txt; do not rotate it accidentally.');}catch(error){if(error.code!=='ENOENT')throw error;}
const key=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(key).digest('hex');
await writeFile(output,`BRATKI 2026 — ключ организатора\n\n${key}\n\nВход: https://nef1xx.github.io/foxt/admin.html\nНе публиковать и не отправлять участникам.\n`,{mode:0o600});
await writeFile(resolve(directory,'bootstrap-admin.sql'),`-- Run once through the Supabase management connection after the migration.\nupdate bratki_private.settings set admin_hash='${hash}' where singleton=true and admin_hash is null;\n`,{mode:0o600});
console.log('Organizer access saved to .private/production-admin.txt; bootstrap SQL saved to .private/bootstrap-admin.sql. Neither file belongs in Git.');
