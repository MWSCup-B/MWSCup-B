import { AUDIO_CATALOG, AUDIO_SCENES, sceneForGame } from './audio-catalog.js';

const settingsKey = 'incident-craft-audio-v1';
const defaults = { muted: false, bgm: 0.35, effects: 0.4 };
const effectIds = ['confirm', 'save', 'start', 'cursor', 'message', 'success'];
export function audioSettings(value) {
  return { muted: value?.muted === true,
    ...Object.fromEntries(['bgm', 'effects'].map(key => [key,
      typeof value?.[key] === 'number' && Number.isFinite(value[key])
        ? Math.max(0, Math.min(1, value[key])) : defaults[key]])) };
}

export class GameAudio {
  constructor({ contextFactory = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(),
    fetcher = (...args) => fetch(...args), storage = () => globalThis.localStorage,
    cryptoProvider = () => globalThis.crypto, now = () => performance.now() } = {}) {
    Object.assign(this, { contextFactory, fetcher, storage, cryptoProvider, now });
    try { this.settings = audioSettings(JSON.parse(storage()?.getItem(settingsKey) ?? 'null')); }
    catch { this.settings = { ...defaults }; }
    this.scene = 'title'; this.version = 0; this.buffers = new Map(); this.effects = new Set();
    this.listeners = new Set(); this.lastEffect = -Infinity; this.hidden = false; this.unlocked = false;
    this.status = '最初の操作で再生します';
  }
  notify() { for (const listener of this.listeners) listener(); }
  setSettings(patch) {
    this.settings = audioSettings({ ...this.settings, ...patch });
    try { this.storage()?.setItem(settingsKey, JSON.stringify(this.settings)); } catch { /* Session controls still work. */ }
    this.applyVolume(); this.notify(); void this.sync();
  }
  applyVolume() {
    if (!this.context) return;
    const time = this.context.currentTime;
    this.musicGain.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.bgm, time, 0.04);
    this.effectsGain.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.effects, time, 0.02);
  }
  async unlock() {
    if (this.hidden) return;
    try {
      if (!this.context) {
        this.context = this.contextFactory();
        this.musicGain = this.context.createGain(); this.musicGain.connect(this.context.destination);
        this.effectsGain = this.context.createGain(); this.effectsGain.connect(this.context.destination);
        this.applyVolume();
      }
      await this.context.resume();
      if (this.hidden || this.context.state !== 'running') return;
      const first = !this.unlocked;
      this.unlocked = true; this.status = ''; this.notify();
      if (first) for (const id of effectIds) void this.buffer(id).catch(() => {});
      await this.sync();
    } catch { this.status = '音声を開始できません。もう一度操作してください'; this.notify(); }
  }
  async manifest() {
    this.manifestPromise ??= this.fetcher('/assets/audio/manifest.json').then(async response => {
      if (!response.ok) throw new Error('Audio catalog unavailable');
      const value = await response.json();
      if (value.version !== 1 || !value.tracks) throw new Error('Invalid audio catalog');
      return value.tracks;
    }).catch(error => { this.manifestPromise = null; throw error; });
    return this.manifestPromise;
  }
  async buffer(id) {
    if (this.buffers.has(id)) return this.buffers.get(id);
    const pending = (async () => {
      const track = (await this.manifest())[id];
      if (!track || !Object.hasOwn(AUDIO_CATALOG, id) || track.file !== `${id}.bin`) throw new Error('Unknown audio');
      const response = await this.fetcher(`/assets/audio/${track.file}`);
      if (!response.ok) throw new Error('Audio unavailable');
      const packed = new Uint8Array(await response.arrayBuffer());
      const crypto = this.cryptoProvider();
      const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(track.key), char => char.charCodeAt(0)),
        'AES-GCM', false, ['decrypt']);
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.subarray(0, 12) }, key, packed.subarray(12));
      return this.context.decodeAudioData(bytes);
    })();
    this.buffers.set(id, pending);
    try { return await pending; } catch (error) { this.buffers.delete(id); throw error; }
  }
  setScene(scene) {
    const next = Object.hasOwn(AUDIO_SCENES, scene) ? scene : 'silent';
    if (this.scene === next) return;
    this.scene = next; this.version++; void this.sync();
  }
  forGame(game) { this.setScene(sceneForGame(game)); }
  retire(active) {
    if (!active) return;
    const time = this.context.currentTime;
    active.gain.gain.cancelScheduledValues(time);
    active.gain.gain.setValueAtTime(active.gain.gain.value, time);
    active.gain.gain.linearRampToValueAtTime(0, time + 0.9);
    active.source.stop(time + 0.95);
  }
  async sync() {
    if (!this.unlocked || this.hidden) return;
    const version = this.version, scene = AUDIO_SCENES[this.scene];
    if (!scene.tracks.length) { this.retire(this.active); this.active = null; this.notify(); return; }
    if (this.settings.muted || this.settings.bgm === 0) return;
    try {
      const manifest = await this.manifest();
      const id = scene.tracks.find(track => manifest[track]);
      if (!id) throw new Error('Missing soundtrack');
      const buffer = await this.buffer(id);
      if (version !== this.version || this.hidden || this.settings.muted || this.settings.bgm === 0) return;
      const time = this.context.currentTime;
      if (this.active?.id === id) {
        this.active.gain.gain.setTargetAtTime(scene.level, time, 0.3); return;
      }
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      source.buffer = buffer; source.loop = true;
      source.connect(gain); gain.connect(this.musicGain);
      gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(scene.level, time + 0.9);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(); this.retire(this.active); this.active = { id, source, gain };
      this.status = ''; this.notify();
    } catch {
      if (version !== this.version) return;
      this.retire(this.active); this.active = null;
      this.status = 'BGMを読み込めませんでした。操作すると再試行します'; this.notify();
    }
  }
  async effect(id) {
    const started = this.now();
    if (!effectIds.includes(id) || !this.unlocked || this.hidden || this.settings.muted ||
      !this.settings.effects || started - this.lastEffect < 70) return;
    this.lastEffect = started;
    try {
      const buffer = await this.buffer(id);
      if (this.hidden || this.settings.muted || !this.settings.effects || this.now() - started > 400) return;
      if (this.effects.size >= 3) {
        const oldest = this.effects.values().next().value;
        oldest.stop(); this.effects.delete(oldest);
      }
      const source = this.context.createBufferSource(); source.buffer = buffer;
      source.connect(this.effectsGain); this.effects.add(source);
      source.onended = () => { source.disconnect(); this.effects.delete(source); };
      source.start();
    } catch { /* Missing sound must never block gameplay. */ }
  }
  async visibility(hidden) {
    this.hidden = hidden; this.version++;
    if (!this.context || !this.unlocked) return;
    if (hidden) {
      for (const source of this.effects) source.stop();
      this.effects.clear();
      await this.context.suspend().catch(() => {});
    } else await this.unlock();
  }
  controls(document, compact = false) {
    const node = document.createElement(compact ? 'details' : 'section'); node.className = 'game-audio-controls';
    if (compact) { const summary = document.createElement('summary'); summary.textContent = '♫ サウンド'; node.append(summary); }
    const panel = document.createElement('div'); panel.className = 'game-audio-panel'; node.append(panel);
    const mute = document.createElement('button'); mute.type = 'button'; mute.dataset.sound = 'none';
    mute.addEventListener('click', () => { this.setSettings({ muted: !this.settings.muted }); void this.unlock(); });
    panel.append(mute);
    const sliders = {};
    for (const [key, title] of [['bgm', 'BGM'], ['effects', '効果音']]) {
      const label = document.createElement('label'); label.textContent = title;
      const output = document.createElement('output'), input = document.createElement('input');
      input.type = 'range'; input.min = 0; input.max = 100; input.step = 1; input.setAttribute('aria-label', `${title}の音量`);
      input.addEventListener('input', () => this.setSettings({ [key]: Number(input.value) / 100 }));
      input.addEventListener('change', () => { if (key === 'effects') void this.effect('confirm'); });
      label.append(output, input); panel.append(label); sliders[key] = { input, output };
    }
    const status = document.createElement('p'); status.className = 'game-audio-status'; panel.append(status);
    const credits = document.createElement('a'); credits.href = '/audio-credits.html'; credits.target = '_blank';
    credits.rel = 'noopener'; credits.textContent = '音楽・効果音のクレジット'; panel.append(credits);
    const update = () => {
      mute.textContent = this.settings.muted ? '音声：オフ（クリックでオン）' : '音声：オン（クリックでオフ）';
      mute.setAttribute('aria-pressed', String(this.settings.muted));
      for (const key of Object.keys(sliders)) {
        sliders[key].input.value = Math.round(this.settings[key] * 100);
        sliders[key].output.textContent = `${Math.round(this.settings[key] * 100)}%`;
      }
      status.textContent = this.status || (this.active ? `♪ ${AUDIO_CATALOG[this.active.id].title}` : 'BGM停止中');
    };
    this.listeners.add(update); update(); return node;
  }
  attach(parent) { if (this.widget && parent) parent.append(this.widget); }
  mount(document) {
    if (this.widget) return;
    this.widget = this.controls(document, true); this.attach(document.querySelector('body > header'));
    const settings = document.getElementById('sound-settings');
    if (settings) settings.append(this.controls(document));
    const interact = event => { if (event.isTrusted && !event.repeat) void this.unlock(); };
    document.addEventListener('pointerdown', interact, { passive: true });
    document.addEventListener('keydown', interact);
    document.addEventListener('click', event => {
      const button = event.target.closest?.('button, a, summary');
      if (!event.isTrusted || !button || button.disabled || button.closest('.game-audio-controls')) return;
      const label = button.textContent.trim();
      const id = button.dataset.sound ?? (['game-start', 'play-game'].includes(button.id) ? 'start'
        : /次の証言|前の証言|次の台詞|前の台詞|次へ|続きを読む/.test(label) ? 'message'
        : /保存|設定を適用/.test(label) ? 'save' : /ゲーム開始|ゲームを開始/.test(label) ? 'start' : 'confirm');
      void this.effect(id);
    }, true);
    document.addEventListener('change', event => {
      if (event.isTrusted && event.target.matches?.('select, input[type="checkbox"], input[type="radio"]')) void this.effect('cursor');
    });
    document.addEventListener('visibilitychange', () => { void this.visibility(document.hidden); });
    globalThis.addEventListener?.('pagehide', () => { void this.visibility(true); });
    globalThis.addEventListener?.('pageshow', () => { void this.visibility(document.hidden); });
    this.hidden = document.hidden;
  }
}

export const gameAudio = new GameAudio();
