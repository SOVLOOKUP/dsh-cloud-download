import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const clientUrl = new URL('../client.js', import.meta.url);

test('client bundle is valid as a classic browser script', async () => {
  const source = await readFile(clientUrl, 'utf8');

  assert.match(source, /window\.__ModuleLoader__\.load\(/u);
  assert.doesNotMatch(
    source,
    /^(?:import|export)\b/mu,
    'DSH client bundles must not contain top-level ESM syntax',
  );

  // The browser loads this file as a classic script, not as a module. A
  // top-level export parses in Node's ESM loader but throws SyntaxError here.
  assert.doesNotThrow(() => new Function(source));
});
