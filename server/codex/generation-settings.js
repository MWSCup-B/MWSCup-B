import { GameError } from '../game.js';

export const GENERATION_OPTIONS = Object.freeze({
  models: ['', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex'],
  reasoningEfforts: ['', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  defaults: { schemaVersion: '1.0', model: '', reasoningEffort: '' },
});

// This is a per-generation CLI override, not part of the incident's technical input.
// Unknown combinations remain an explicit CLI error; never silently change models.
export function normalizeGenerationSettings(value = GENERATION_OPTIONS.defaults) {
  const invalid = field => { throw new GameError('INVALID_GENERATION_SETTINGS', `generationSettings.${field}`,
    'モデルIDと、選択可能なエフォートを指定してください。'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('schemaVersion');
  if (Object.keys(value).some(key => !['schemaVersion', 'model', 'reasoningEffort'].includes(key))) invalid('fields');
  if (value.schemaVersion !== '1.0') invalid('schemaVersion');
  if (typeof value.model !== 'string' || value.model.length > 120
    || (value.model && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value.model))) invalid('model');
  if (!GENERATION_OPTIONS.reasoningEfforts.includes(value.reasoningEffort)) invalid('reasoningEffort');
  return { schemaVersion: '1.0', model: value.model, reasoningEffort: value.reasoningEffort };
}
