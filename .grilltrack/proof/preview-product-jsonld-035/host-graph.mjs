import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { auditedCouponTransformFrom } from '../../../scripts/coupon-build-transform.mjs';

let moduleCount = 0;
let structuredDataModules = [];
const bundle = await rolldown({
  input: resolve('src/plugin.ts'),
  platform: 'browser',
  optimization: { inlineConst: false },
  plugins: [
    await auditedCouponTransformFrom(resolve('.')),
    {
      name: 'commerce-pure-vendor-modules',
      transform(code, id) {
        return id.includes('/node_modules/@oslojs/') ? { code, moduleSideEffects: false } : null;
      },
    },
    {
      name: 'prove-structured-data-host-exclusion',
      buildEnd(error) {
        if (error) throw error;
        const modules = [...this.getModuleIds()];
        moduleCount = modules.length;
        structuredDataModules = modules.filter((id) => id.includes('/src/features/structured-data/'));
        assert.deepEqual(structuredDataModules, []);
      },
    },
  ],
});
try {
  await bundle.generate({ format: 'esm', minify: true });
} finally {
  await bundle.close();
}
console.log(JSON.stringify({ entry: 'src/plugin.ts', moduleCount, structuredDataModules, hostOnly: true }));
