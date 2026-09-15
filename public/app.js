const screen = document.querySelector('#screen');
const errorBox = document.querySelector('#error');
let token = null;
let game = null;
let busy = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, handler, disabled = false) {
  const node = element('button', text);
  node.type = 'button';
  node.disabled = disabled;
  node.addEventListener('click', handler);
  return node;
}

async function request(path, body) {
  if (busy) return;
  busy = true;
  errorBox.textContent = '';
  const controls = [...screen.querySelectorAll('button, input')].map(node => [node, node.disabled]);
  controls.forEach(([node]) => { node.disabled = true; });
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || '処理に失敗しました。');
    if (data.token) token = data.token;
    game = data.game;
    render();
  } catch (error) {
    errorBox.textContent = error instanceof TypeError ? '通信できません。サーバーの起動を確認してください。' : error.message;
  } finally {
    busy = false;
    controls.forEach(([node, disabled]) => { if (node.isConnected) node.disabled = disabled; });
  }
}

function action(actionName, evidenceId) {
  return request('/api/action', { action: actionName, ...(evidenceId ? { evidenceId } : {}) });
}

function card(item) {
  const node = element('div', undefined, 'card');
  node.append(element('strong', item.title), element('p', item.kind, 'kind'), element('p', item.text));
  return node;
}

function render() {
  screen.replaceChildren();
  const titles = { detective: '探偵パート', courtroom: '法廷パート', result: '結果' };
  const title = element('h1', game ? titles[game.phase] : 'インシデント調査ゲーム');
  title.id = 'screen-title';
  title.tabIndex = -1;
  screen.append(title);
  if (!game) {
    screen.append(element('p', '証拠を取得し、証言と照合して提示する操作を確認します。'));
    screen.append(button('ゲーム開始', () => request('/api/start', {})));
  } else if (game.phase === 'detective') {
    screen.append(element('p', '証拠候補を選んで取得してください。所持証拠は法廷で提示できます。'));
    screen.append(element('h2', '証拠候補'));
    for (const candidate of game.candidates) {
      const owned = game.inventory.some(item => item.id === candidate.id);
      const row = element('div', undefined, 'card');
      row.append(button(`${candidate.title}：${owned ? '取得済み' : '取得する'}`, () => action('collect', candidate.id), owned));
      screen.append(row);
    }
    screen.append(element('h2', '所持証拠'));
    if (!game.inventory.length) screen.append(element('p', '証拠を1件以上取得すると法廷へ進めます。'));
    game.inventory.forEach(item => screen.append(card(item)));
    screen.append(button('法廷パートへ', () => action('courtroom'), !game.inventory.length));
  } else if (game.phase === 'courtroom') {
    screen.append(element('p', game.instruction));
    screen.append(element('h2', '証言'));
    screen.append(card({ title: '証言', ...game.testimony }));
    const fieldset = element('fieldset');
    fieldset.append(element('legend', '提示する所持証拠を1つ選択'));
    const present = button('証拠を提示する', () => {
      const selected = fieldset.querySelector('input:checked');
      if (selected) action('present', selected.value);
    }, true);
    for (const item of game.inventory) {
      const label = element('label', undefined, 'card');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'evidence';
      radio.value = item.id;
      radio.addEventListener('change', () => { present.disabled = false; });
      label.append(radio, element('strong', item.title), element('p', item.kind, 'kind'), element('p', item.text));
      fieldset.append(label);
    }
    screen.append(fieldset, element('p', 'プレイヤーの推論：選択した証拠が、証言と矛盾することを示します。'), present);
  } else if (game.phase === 'result') {
    screen.append(element('p', game.result.success ? '矛盾の指摘が成立しました。' : 'この証拠では矛盾の指摘は成立しませんでした。'));
    screen.append(element('p', game.notice));
    screen.append(element('p', 'もう一度操作を確認するには、ページを再読み込みしてください。'));
  }
  title.focus();
}

render();
