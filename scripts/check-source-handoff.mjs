/** Local handoff gate. Reports paths/line numbers only, never matching values. No network. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
const staged=process.argv.includes('--staged');
const git=(args,encoding='utf8')=>execFileSync('git',args,{encoding,maxBuffer:32*1024*1024});
const args=staged?['ls-files','--cached','-z']:['ls-files','--cached','--others','--exclude-standard','-z'];
const paths=[...new Set(git(args).split('\0').filter(Boolean))].sort();
if(!paths.length)throw Error('No files to audit; stage the reviewed files first or omit --staged.');
const rules=[
 ['private-key',/-----BEGIN (?:(?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g],
 ['telegram-token',/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g],
 ['provider-key',/\b(?:(?:sb_secret_|sb_publishable_|sk_live_|sk_test_|ghp_|github_pat_|vercel_|vcp_)[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g],
 ['other-provider-key',/\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|gh[ousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g],
 ['jwt',/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/g],
 ['credential-url',/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/'"`]+:[^\s@/'"`]+@[^\s/'"`]+/g],
 ['http-credentials',/https?:\/\/[^\s/'"`@]+@[^\s/'"`]+/g],
 ['literal-password',/(?:password|passwd|api[_-]?key|access[_-]?token|service[_-]?role[_-]?key|bot[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"'\r\n]{8,}["']/gi],
];
const localSecrets=[];
if(existsSync('.env.local'))for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){
 const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
 if(!m||!/(?:KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|CONNECTION)/.test(m[1]))continue;
 const value=m[2].replace(/^(["'])(.*)\1$/,'$2');if(value.length>=10)localSecrets.push(value);
}
const findings=[],reviewedFixtures=[],manifest=[];
for(const file of paths){
 const forbidden=file!=='.env.example'&&(/(^|\/)\.env[^/]*$|\.env(?:\.[^/]*)?$|\.(?:zip|7z|pem|key|p12|pfx|db|sqlite3?|dump|bak|har|log)$/i.test(file)||/(^|\/)(?:\.admin-local|\.admin-postgres|\.next[^/]*|\.vercel|node_modules|qa|backups|dumps)(\/|$)/.test(file));
 if(forbidden)findings.push({file,line:0,kind:'forbidden-path'});
 const bytes=staged?git(['show',':'+file],null):readFileSync(file);
 manifest.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 if(bytes.includes(0))continue;
 const text=bytes.toString('utf8');
 for(const value of localSecrets){const index=text.indexOf(value);if(index>=0)findings.push({file,line:text.slice(0,index).split('\n').length,kind:'actual-local-env-secret-copy'});}
 for(const [kind,pattern]of rules){
  pattern.lastIndex=0;
  for(const match of text.matchAll(pattern)){
   const item={file,line:text.slice(0,match.index).split('\n').length,kind};
   // Existing TLS rejection fixture uses the reserved, non-routable .invalid domain.
   // Actual local-secret reuse is checked independently above and is never waived.
   if(kind==='credential-url'&&file==='tests/launch-readiness.test.ts'){
    try{if(new URL(match[0]).hostname==='db.example.invalid'){reviewedFixtures.push(item);continue;}}catch{}
   }
   if(kind==='http-credentials'&&file==='tests/booking-contact.test.ts'){
    try{const u=new URL(match[0]);if(u.hostname==='t.me'&&['u','user','x','foo','name'].includes(u.username)&&['p','pass','password','secret','pw','test','x'].includes(u.password)){reviewedFixtures.push(item);continue;}}catch{}
   }
   findings.push(item);
  }
 }
}
mkdirSync('qa',{recursive:true});
const summary={mode:staged?'staged':'worktree',files:paths.length,totalBytes:manifest.reduce((sum,item)=>sum+item.bytes,0),findings,reviewedFixtures};
writeFileSync('qa/source-handoff-'+summary.mode+'.json',JSON.stringify({...summary,manifest},null,2));
console.log(JSON.stringify(summary,null,2));
if(findings.length)process.exitCode=1;
