import { readFile, writeFile } from 'node:fs/promises';

/**
 * DSH client bundles are classic scripts that register a factory through
 * `window.__ModuleLoader__.load({ id, factory })`; they are not ES modules.
 *
 * TypeScript marks `src/client.ts` as a module because it uses `import type`
 * and `declare global`, and therefore appends `export {};` to the emitted
 * `client.js`. The browser executes that file as a classic script, where an
 * `export` statement is a SyntaxError, so the whole plugin fails to activate.
 * Strip the marker after compilation and reject any remaining top-level ESM
 * syntax instead of publishing another broken bundle.
 */

const bundleUrl = new URL('../client.js', import.meta.url);
const source = await readFile(bundleUrl, 'utf8');
const stripped = source.replace(/\nexport \{\};\s*$/u, '\n');

if (stripped !== source) {
  await writeFile(bundleUrl, stripped);
  console.log('strip-client-export: removed trailing export {} from client.js');
}

if (/^(?:import|export)\b/mu.test(stripped)) {
  throw new Error(
    'strip-client-export: client.js still contains top-level import/export syntax; ' +
      'DSH executes client bundles as classic scripts',
  );
}

if (!stripped.includes('window.__ModuleLoader__.load(')) {
  throw new Error(
    'strip-client-export: client.js does not register through window.__ModuleLoader__.load()',
  );
}
