import { readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { validateDocument, fail } from './schema.js';
import { unique } from './catalog.js';

export function validateNetworkPresets(presets) {
  if (!Array.isArray(presets) || !presets.length || presets.length > 32) {
    fail('INVALID_NETWORK_PRESETS', 'networkPresets', 'Network presetの件数が不正です。');
  }
  presets.forEach(item => validateDocument('network-preset', item));
  unique(presets, item => item.id, 'networkPresets.id');
  return presets;
}

// Backend管理下のJSONだけを読み込み、定義中のパスやURLは参照しない。
export async function loadNetworkPresets(directory = new URL('../../data/networks/', import.meta.url)) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(item => item.name.endsWith('.json'));
  const presets = [];
  for (const entry of files.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !/^[a-z][a-z0-9_-]*\.json$/.test(entry.name)) {
      fail('INVALID_NETWORK_PRESET_FILE', 'networkPresets', '通常のJSONファイルだけを使用してください。');
    }
    const handle = await open(new URL(entry.name, directory), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if ((await handle.stat()).size > 128 * 1024) fail('INPUT_TOO_LARGE', 'networkPresets', '定義が大きすぎます。');
      try { presets.push(JSON.parse(await handle.readFile('utf8'))); }
      catch { fail('INVALID_JSON', 'networkPresets', 'Network presetのJSONが不正です。'); }
    } finally { await handle.close(); }
  }
  return validateNetworkPresets(presets);
}
