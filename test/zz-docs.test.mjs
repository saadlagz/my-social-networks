import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import YAML from 'yaml';

// chaque route déclarée dans un contrôleur doit être documentée dans docs/openapi.yaml
test('toutes les routes sont documentées dans OpenAPI', () => {
  const spec = YAML.parse(readFileSync(new URL('../docs/openapi.yaml', import.meta.url), 'utf8'));
  const documented = new Set(Object.entries(spec.paths).flatMap(([path, item]) => Object.keys(item)
    .filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
    .map((method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`)));
  const dir = new URL('../src/controllers/', import.meta.url);
  const declared = readdirSync(dir).flatMap((file) => [...readFileSync(new URL(file, dir), 'utf8')
    .matchAll(/this\.app\.(get|post|put|patch|delete)\('([^']+)'/g)]
    .map(([, method, path]) => `${method.toUpperCase()} ${path}`));

  const missing = declared.filter((route) => !documented.has(route));
  const extra = [...documented].filter((route) => !declared.includes(route));

  assert.deepEqual(missing, [], `routes non documentées : ${missing}`);
  assert.deepEqual(extra, [], `routes documentées mais inexistantes : ${extra}`);
});
