import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const root=fileURLToPath(new URL('../../',import.meta.url));
const helper=new URL('../../.github/scripts/registry-recovery.mjs',import.meta.url);
async function fixture(t,version='0.3.0-beta.0'){
 const dir=await mkdtemp(join(tmpdir(),'commerce-registry-recovery-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');
 for(const name of ['package.json','emdash-plugin.jsonc']){const v=JSON.parse(await readFile(join(root,name),'utf8'));v.version=version;await writeFile(join(dir,name),JSON.stringify(v));}
 await mkdir(join(dir,'.changeset'));await mkdir(join(dir,'src'));
 await writeFile(join(dir,'src/plugin.ts'),'export default {};\n');
 await writeFile(join(dir,'.changeset/config.json'),await readFile(join(root,'.changeset/config.json')));
 if(version.includes('-'))await writeFile(join(dir,'.changeset/pre.json'),'{"mode":"pre","tag":"beta"}\n');
 git('add','.');git('commit','-m','Released source');const tagSha=git('rev-parse','HEAD');git('tag','v'+version);
 await writeFile(join(dir,'CI-repair.md'),'CI only\n');git('add','.');git('commit','-m','Repair CI only');
 const context={cwd:dir,eventName:'workflow_dispatch',ref:'refs/heads/main',requested:'true',sourceSha:git('rev-parse','HEAD')};
 return {dir,git,tagSha,version,context};
}

test('existing version tag yields no new Changesets publication events',async t=>{
 const f=await fixture(t),output=join(f.dir,'changesets-output.ndjson');
 execFileSync(process.execPath,[join(root,'node_modules/@changesets/cli/bin.js'),'tag'],{cwd:f.dir,stdio:['ignore','pipe','pipe'],env:{...process.env,CHANGESETS_OUTPUT:output}});
 const events=await readFile(output,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
 assert.equal(events.trim(),'');assert.equal(f.git('rev-parse','v'+f.version),f.tagSha);
});
for(const version of ['0.3.0','0.3.0-beta.0'])test(`Registry recovery selects existing ${version} without rewriting its tag`,async t=>{
 const f=await fixture(t,version);const {registryRecovery}=await import(helper);
 const result=registryRecovery(f.context);
 assert.equal(result.tagSha,f.tagSha);assert.equal(result.sourceSha,f.context.sourceSha);assert.notEqual(result.sourceSha,result.tagSha);
 assert.deepEqual(result.packages,[{name:'@dinkuskit/commerce',version}]);
 assert.equal(result.selector,`dinkus-commerce${version.includes('-')?'-beta':''}@${version}`);
 assert.equal(f.git('rev-parse','v'+version),f.tagSha);assert.equal(f.git('status','--porcelain'),'');
 assert.equal(Object.hasOwn(result,'published'),false,'recovery must not claim a new tag/publication');
});
test('recovery refuses missing tags, runtime changes and changed metadata',async t=>{
 const {registryRecovery}=await import(helper);
 for(const change of ['tag','runtime','version']){
  const f=await fixture(t);
  if(change==='tag')f.git('tag','-d','v'+f.version);
  else if(change==='runtime'){await writeFile(join(f.dir,'src/plugin.ts'),'export default { changed: true };\n');f.git('add','.');f.git('commit','-m','Changed runtime');f.context.sourceSha=f.git('rev-parse','HEAD');}
  else {const p=JSON.parse(await readFile(join(f.dir,'package.json'),'utf8'));p.version='0.3.0-beta.1';await writeFile(join(f.dir,'package.json'),JSON.stringify(p));}
  assert.throws(()=>registryRecovery(f.context));
 }
});
test('recovery is admitted only for explicit main workflow dispatch',async t=>{
 const f=await fixture(t);const {registryRecovery}=await import(helper);
 for(const delta of [{eventName:'push'},{requested:'false'},{ref:'refs/heads/other'},{sourceSha:f.tagSha}])assert.throws(()=>registryRecovery({...f.context,...delta}));
});
test('Registry job has a separate recovery signal and skips tag mutation for recovery',async()=>{
 const s=await readFile(join(root,'.github/workflows/release.yml'),'utf8');
 assert.match(s,/published: \$\{\{ steps\.changesets\.outputs\.published \}\}/);
 assert.match(s,/registry-recovery: \$\{\{ steps\.recovery\.outputs\.ready \}\}/);
 assert.match(s,/if: .*needs\.publish\.outputs\.published == 'true'.*needs\.publish\.outputs\['registry-recovery'\] == 'true'/);
 assert.match(s,/name: Create tag and GitHub Release\n\s+if: \$\{\{ !inputs\.publish-only \}\}/);
 assert.match(s,/name: Generate token\n\s+if: \$\{\{ !inputs\.publish-only \}\}/);
 assert.match(s,/name: Validate Registry-only recovery\n\s+if: \$\{\{ inputs\.publish-only \}\}/);
});
