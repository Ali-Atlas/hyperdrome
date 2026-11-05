/**
 * Resolve the app's `@/` import alias (jsconfig.json) for plain Node scripts that load services:
 * `node --import ./scripts/register-alias.mjs scripts/<name>.mjs`. Next.js and Vitest resolve the
 * alias themselves; Node needs this hook. A directory import resolves to its `index.js`.
 */
import { existsSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
    const url = new URL(specifier.slice(2), root);
    const path = fileURLToPath(url);
    const isDirectory = existsSync(path) && statSync(path).isDirectory();
    return nextResolve(isDirectory ? `${url.href}/index.js` : url.href, context);
  },
});
