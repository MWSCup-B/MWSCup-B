import { readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { validateDocument, fail } from './schema.js';

export const sources = ['vulnerabilities', 'attackerInitialPrivileges', 'requiredUserActions',
  'loggingConfiguration', 'authenticationConditions', 'otherConditions'];

export function unique(items, key, field) {
  const seen = new Set();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) fail('DUPLICATE_ID', field, '同じ識別子または条件が重複しています。');
    seen.add(value);
  }
}

export function validateDefinition(definition) {
  validateDocument('attack-definition', definition);
  unique(definition.bindings, item => item.id, 'bindings');
  unique(definition.references, item => item.id, 'references');
  unique(definition.observableArtifacts, item => item.id, 'observableArtifacts');
  const bindings = new Map(definition.bindings.map(item => [item.id, item.kind]));
  const requireBinding = (name, kind, field) => {
    if (!bindings.has(name) || (kind && bindings.get(name) !== kind)) {
      fail('INVALID_BINDING', field, '割当て変数の参照または種類が不正です。');
    }
  };
  for (const group of ['targetTypes', 'platforms', 'requiredServices']) {
    for (const item of definition[group]) {
      requireBinding(item.binding, group === 'requiredServices' ? 'service' : null, group);
      if (group === 'requiredServices') requireBinding(item.node, 'node', group);
      if (group === 'platforms' && bindings.get(item.binding) === 'entity') {
        fail('INVALID_BINDING', group, 'platformsにはnodeまたはserviceを指定してください。');
      }
      unique(item.values, v => v, group);
    }
  }
  for (const item of definition.requiredReachability) {
    requireBinding(item.from, 'node', 'requiredReachability.from');
    requireBinding(item.toService, 'service', 'requiredReachability.toService');
  }
  const conditions = [...definition.prerequisites, ...definition.requiredPrivileges, ...definition.effects,
    ...definition.observableArtifacts.flatMap(item => item.conditions)];
  for (const condition of conditions) {
    for (const arg of condition.args) requireBinding(arg.slice(1), null, 'condition.args');
  }
  unique(definition.effects, item => JSON.stringify([item.source, item.predicate, item.args]), 'effects');
  for (const reference of definition.references) {
    let url;
    try { url = new URL(reference.url); } catch { fail('INVALID_REFERENCE', 'references.url', '参照URLが不正です。'); }
    if (url.protocol !== 'https:' || url.username || url.password) {
      fail('INVALID_REFERENCE', 'references.url', '参照は認証情報のないHTTPS URLにしてください。');
    }
  }
  return definition;
}

export function validateCatalog(definitions) {
  if (!Array.isArray(definitions) || definitions.length > 256) fail('INVALID_CATALOG', 'catalog', 'カタログの形式または件数が不正です。');
  definitions.forEach(validateDefinition);
  unique(definitions, item => item.id, 'catalog.id');
  return definitions;
}

// 読込み先はBackendが指定するローカルディレクトリ。URL・定義中のパスは取得しない。
export async function loadCatalog(directory = new URL('../../data/attacks/', import.meta.url)) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(item => item.name.endsWith('.json'));
  if (files.length > 256) fail('INVALID_CATALOG', 'catalog', 'カタログが大きすぎます。');
  const definitions = [];
  for (const entry of files.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !/^[a-z][a-z0-9_-]*\.json$/.test(entry.name)) {
      fail('INVALID_CATALOG_FILE', 'catalog', '通常のJSONファイルだけを使用してください。');
    }
    const path = new URL(entry.name, directory);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if ((await handle.stat()).size > 128 * 1024) fail('INPUT_TOO_LARGE', 'catalog', '定義が大きすぎます。');
      let definition;
      try { definition = JSON.parse(await handle.readFile('utf8')); }
      catch { fail('INVALID_JSON', 'catalog', '攻撃定義のJSONが不正です。'); }
      definitions.push(definition);
    } finally { await handle.close(); }
  }
  return validateCatalog(definitions);
}
