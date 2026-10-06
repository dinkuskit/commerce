// A reproducible packaging diagnostic, not installed sandbox acceptance.
import { rolldown } from 'rolldown';
import { bundlePlugin } from '@emdash-cms/plugin-cli';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory=resolve('.grilltrack/work/coupon-block-kit-20261003/package-boundary');
await mkdir(directory,{recursive:true});
const entry=resolve(directory,'auth-entry.mjs');
await writeFile(entry,"export { hasPermission, toRoleLevel } from '@emdash-cms/auth';\n");
const build=await rolldown({input:entry,platform:'browser'});
let helper;
try { helper=(await build.generate({format:'esm',minify:true})).output[0].code; }
finally { await build.close(); }
const helperFile=resolve(directory,'auth-helper.mjs');
await writeFile(helperFile,helper);
const {hasPermission,toRoleLevel}=await import(helperFile);
const permissions=[10,20,30,40,50].map(role=>({role,
  catalog:hasPermission({role:toRoleLevel(role)},'content:edit_any'),
  coupons:hasPermission({role:toRoleLevel(role)},'plugins:manage')}));
let packaged;
try { const artifact=await bundlePlugin({dir:resolve('.tmp/sandbox-source'),outDir:resolve(directory,'build')});
  packaged={status:'PASS',sha256:artifact.sha256,bytes:artifact.tarballBytes};
} catch(error) {
  if(error.code!=='VALIDATION_FAILED'||!error.message.includes('per-file maximum of 128')) throw error;
  packaged={status:'BLOCKED',code:error.code,error:error.message};
}
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtime=await readFile(resolve(directory,'build/plugin.mjs'));
const manifest=JSON.parse(await readFile(resolve(directory,'build/manifest.json'),'utf8'));
const report={scope:'Local package validation; no Registry publication or installed browser acceptance',
  runtime:{bytes:runtime.byteLength,sha256:sha256(runtime)},
  publicAuthHelper:{bytes:Buffer.byteLength(helper),sha256:sha256(helper),permissions},
  plugin:{id:manifest.id,couponsRegistered:!!manifest.storage.coupons},packaged,
  installedBrowserAcceptance:'NOT_RUN',dependencies:{}};
for(const name of ['emdash','@emdash-cms/auth','@emdash-cms/plugin-cli','@lingui/core','rolldown']) {
  const bytes=await readFile(resolve('node_modules',name,'package.json'));
  report.dependencies[name]={version:JSON.parse(bytes).version,packageJsonSha256:sha256(bytes)};
}
await writeFile(resolve(directory,'boundary.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(packaged.status==='BLOCKED') process.exitCode=1;
