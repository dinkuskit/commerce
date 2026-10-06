import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { resolve, relative } from 'node:path';

const PACKAGE_SHA256 = 'f319c769869de46b669cb3b732cc177a522d16d0c0b512dd992b4ebe75c8131c';
const SOURCES = new Map([
  ['dist/index.mjs', '9bb152614ad0283699b89928b501d0a05263d832dde3657712c0b296efbd42ad'],
  ['dist/types-ndj-bYfi.mjs', '26b974a1ab7f8fdfe7fa2c7bf69ab5ac09be9b69f4df087ef97edfd92bc8c3a8'],
  ['dist/authenticate-DJrZRBu9.mjs', '9dc7b81142bc7753949bd6b9f702c5298758f23f67e39f081cbb33999b06a6b9'],
  ['dist/passkey/index.mjs', '6399e0e5d9c3897508a3ea920d757a72be28a641fb8cfb2373f0592dd4740425'],
  ['dist/oauth/providers/github.mjs', '24899086fb43345bebbcb3768ba462643f2c06bf15bef896add4f526559399c3'],
  ['dist/oauth/providers/google.mjs', '335e053f33d7045037b2a487b84c6cfbe239505a2ded02bd75556acdd6ca88c6'],
]);
const INITIALIZERS = new Map([
  ['httpUrl', '32a7d81e4b166aca900d2a967aee490b1b2f5ef953f420d2bbc7819a7ba49cf5'],
  ['oauthProviderSchema', 'b85a547e8e1fec3e52b5b8d237329b6481ae1f4f9a81ca8026c7865ecc302f8a'],
  ['authConfigSchema', '045ed841930b97536150d266445b47b6c244db70ef99c87173b44c79cb3de9cc'],
]);

const sha256 = value => createHash('sha256').update(value).digest('hex');

export function createCouponBuildTransform({ authPackageJson, authRoot }) {
  if (sha256(authPackageJson) !== PACKAGE_SHA256) throw new Error('Pinned @emdash-cms/auth package identity changed');
  const sourceHashes = new Map(SOURCES);
  const root = resolve(authRoot);
  return {
    name: 'coupon-audited-auth-purity',
    async transform(code, id) {
      if (!resolve(id).startsWith(root + '/')) return null;
      const path = relative(root, id);
      const expected = sourceHashes.get(path);
      if (!expected || sha256(code) !== expected) throw new Error(`Unexpected @emdash-cms/auth source: ${path}`);
      if (path !== 'dist/index.mjs') return { code, moduleSideEffects: false };

      const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const found = new Set();
      const result = ts.transform(source, [context => root => {
        const visit = node => {
          if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && INITIALIZERS.has(node.name.text)) {
            if (found.has(node.name.text)) throw new Error('Unexpected duplicated auth initializer');
            found.add(node.name.text);
            const initializer = node.initializer;
            if (!initializer || sha256(initializer.getText(source)) !== INITIALIZERS.get(node.name.text)) {
              throw new Error(`Unexpected initializer for @emdash-cms/auth ${node.name.text}`);
            }
            let wrapped = context.factory.createCallExpression(
              context.factory.createParenthesizedExpression(
                context.factory.createArrowFunction(
                  undefined, undefined, [], undefined,
                  context.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                  initializer,
                ),
              ),
              undefined, [],
            );
            wrapped = ts.addSyntheticLeadingComment(
              wrapped,
              ts.SyntaxKind.MultiLineCommentTrivia,
              ' @__PURE__ ',
              false,
            );
            return context.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, wrapped);
          }
          return ts.visitEachChild(node, visit, context);
        };
        return ts.visitNode(root, visit);
      }]);
      if (found.size !== INITIALIZERS.size) throw new Error('Audited auth initializer set changed');
      const printed = ts.createPrinter({ removeComments: false }).printFile(result.transformed[0]);
      result.dispose();
      return { code: printed, moduleSideEffects: false };
    },
  };
}

export async function auditedCouponTransformFrom(root) {
  const packageJson = await readFile(`${root}/node_modules/@emdash-cms/auth/package.json`, 'utf8');
  return createCouponBuildTransform({
    authPackageJson: packageJson,
    authRoot: `${root}/node_modules/@emdash-cms/auth`,
  });
}
