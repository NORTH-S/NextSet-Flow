import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const browserRoot = resolve(root, 'dist');
const modules = new Map();
const visiting = new Set();

// Keep a separate scope for every browser module, including private helpers.
async function bundleModule(path) {
  const id = relative(browserRoot, path).replaceAll('\\', '/');
  if (modules.has(id)) return id;
  if (visiting.has(id)) throw new Error(`Offline bundle does not support an import cycle: ${id}`);
  if (id.startsWith('../') || id === '..') throw new Error('Offline bundle may only include browser files.');
  visiting.add(id);
  let code = await readFile(path, 'utf8');
  const imports = [...code.matchAll(/^import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm)];
  for (const match of imports) {
    if (!match[2].startsWith('./') && !match[2].startsWith('../')) throw new Error(`Unsupported browser import: ${match[2]}`);
    const dependency = await bundleModule(resolve(dirname(path), match[2]));
    const bindings = match[1].split(',').map((binding) => binding.trim()).filter(Boolean).map((binding) => {
      if (!/^\w+(?:\s+as\s+\w+)?$/.test(binding)) throw new Error(`Unsupported named import: ${binding}`);
      return binding.replace(/\s+as\s+/, ': ');
    }).join(', ');
    code = code.replace(match[0], `const { ${bindings} } = __offlineModules[${JSON.stringify(dependency)}];`);
  }
  const exports = [...code.matchAll(/^export\s+(?:(?:async\s+)?function|const|let|var|class)\s+(\w+)/gm)].map((match) => match[1]);
  code = code.replace(/^export\s+(?=(?:async\s+)?function|const|let|var|class)/gm, '');
  if (/^\s*(?:import|export)\s/m.test(code)) throw new Error(`Unsupported module syntax in ${id}`);
  modules.set(id, `__offlineModules[${JSON.stringify(id)}] = (() => {\n${code}\nreturn { ${exports.join(', ')} };\n})();`);
  visiting.delete(id);
  return id;
}

const [html, css] = await Promise.all([
  readFile(resolve(browserRoot, 'index.html'), 'utf8'),
  readFile(resolve(browserRoot, 'styles.css'), 'utf8'),
]);
await bundleModule(resolve(browserRoot, 'app.js'));
const js = `(() => {\n'use strict';\nglobalThis.__NEXTSET_OFFLINE__ = true;\nconst __offlineModules = Object.create(null);\n${[...modules.values()].join('\n')}\n})();`.replace(/<\/script/gi, '<\\/script');
const output = html
  .replace(/\s*<link\s+rel="icon"[^>]*>/, '')
  .replace(/<link\s+rel="stylesheet"\s+href="\.\/styles\.css">/, `<style>\n${css}\n</style>`)
  .replace(/<script\s+type="module"\s+src="\.\/app\.js"><\/script>/, `<script>\n${js}\n</script>`);
if (output === html || /<script\s+type="module"\s+src="\.\/app\.js"/.test(output)) throw new Error('Offline HTML shell did not match the browser entrypoint.');
const target = resolve(root, 'NextSet Flow Demo.html');
await writeFile(target, output, 'utf8');
console.log(target);
