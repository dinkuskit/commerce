import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmod,copyFile,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const workflow=await readFile(join(root,'.github/workflows/emdash-release.yml'),'utf8');
const plan=workflow.match(/name: "Plan Changesets plugin releases"[\s\S]*?run: \|\n((?: {10}.*\n)+)/)?.[1]?.replace(/^ {10}/gm,'');
assert.ok(plan,'workflow must supply its actual planner shell step');

async function fixture(t,version='0.3.0-beta.0') {
 const dir=await mkdtemp(join(tmpdir(),'commerce-release-plan-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'src'));await mkdir(join(dir,'fail-resolver'));
 for(const name of ['package.json','emdash-plugin.jsonc']){
  const value=JSON.parse(await readFile(join(root,name),'utf8'));value.version=version;
  await writeFile(join(dir,name),JSON.stringify(value));
 }
 await copyFile(join(root,'src/plugin.ts'),join(dir,'src/plugin.ts'));
 await symlink(join(root,'node_modules'),join(dir,'node_modules'),'dir');
 const npx=join(dir,'fail-resolver/npx');await writeFile(npx,'#!/bin/sh\necho "transient npm resolver unavailable" >&2\nexit 86\n');await chmod(npx,0o755);
 const output=join(dir,'github-output');
 return {dir,output,run(packages=[{name:'@dinkuskit/commerce',version}]){
  return execFileSync('bash',['-c',plan],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:join(dir,'fail-resolver')+':'+process.env.PATH,EMDASH_PUBLISHED_PACKAGES:JSON.stringify(packages),GITHUB_OUTPUT:output}});
 }};
}

test('cold planner job installs locked dependencies before planning',()=>{
 const before=workflow.slice(0,workflow.indexOf('name: "Plan Changesets plugin releases"'));
 assert.match(before,/run: npm ci/);
});
for(const version of ['0.3.0','0.3.0-beta.0'])test(`actual planner step works with unavailable transient resolver (${version})`,async t=>{
 const f=await fixture(t,version);f.run();
 assert.equal((await readFile(f.output,'utf8')).trim(),`selectors=["dinkus-commerce@${version}"]`);
});
test('actual planner rejects a published version mismatch',async t=>{
 const f=await fixture(t);
 assert.throws(()=>f.run([{name:'@dinkuskit/commerce',version:'0.3.0-beta.1'}]),error=>/Changesets reported/.test(error.stderr?.toString()??''));
 await assert.rejects(readFile(f.output),{code:'ENOENT'});
});
test('actual planner never adds unrelated packages to the release matrix',async t=>{
 const f=await fixture(t);f.run([{name:'@dinkuskit/unrelated',version:'0.3.0-beta.0'}]);
 assert.equal((await readFile(f.output,'utf8')).trim(),'selectors=[]');
});
