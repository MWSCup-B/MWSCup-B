// View state is owned by one game render instance; saved data comes from its session.
export function renderInvestigationWorkspace(game, state, action, redraw, { el, button, submission }) {
  const root = el('section', undefined, 'investigation-workspace');
  const materials = game.workbench.materials;
  const material = materials.find(item => item.materialId === state.material);
  const mode = state.mode ?? 'scene';
  const switchMode = next => { state.previous = mode; state.mode = next; redraw(); };
  const toolbar = el('nav', undefined, 'workspace-toolbar');
  toolbar.setAttribute('aria-label', '調査モード');
  toolbar.append(button('現場へ戻る', () => { state.mode = 'scene'; state.tool = null; redraw(); }),
    button('Notes', () => switchMode('notes')), button('Talk', () => switchMode('talk')),
    button('Report', () => switchMode('report')),
    button('提出する証拠を決める', () => switchMode('submission'), '', !game.canReturnToCourt));
  const progress = game.workbench.progress;
  toolbar.append(el('span', `${progress.complete ? '調査完了' : '証拠を収集中'} ${progress.collected} / ${progress.required}`));
  root.append(toolbar);
  if (mode === 'submission') { root.append(submission()); return root; }
  if (['notes', 'talk', 'report'].includes(mode)) {
    const page = el('section', undefined, 'workspace-auxiliary');
    page.append(button('直前の調査へ戻る', () => { state.mode = state.resume ?? 'scene'; redraw(); }));
    if (mode === 'notes') {
      page.append(el('h2', '保存した発見値（検索用・証拠ではありません）'));
      for (const entry of game.workbench.savedObservations) page.append(el('p', `${entry.field}: ${entry.value} — ${materials.find(item => item.materialId === entry.materialId)?.label}`));
      page.append(el('h2', '保存した証拠（原文の記録）'));
      for (const source of materials) for (const fact of source.savedFacts) page.append(el('p', `${source.label} / 行${fact.line}: ${fact.text}`));
    } else if (mode === 'talk') {
      page.append(el('h2', '検察側の主張'), el('p', game.investigationClaim?.spokenContent ?? '資料を照合してください。'),
        el('p', '記録にある事実と、その解釈を分けましょう。IPやアカウントの一致だけでは人物を特定できません。'));
    } else page.append(el('h2', '事件報告'), el('p', game.synopsis), el('h3', '調査できる資料'),
      ...materials.map(item => el('p', item.label)));
    root.append(page); return root;
  }
  state.resume = mode;
  if (mode === 'scene' || !material) {
    const scene = el('section', undefined, 'workspace-scene'); scene.setAttribute('aria-label', '調査現場');
    scene.append(el('h2', '機器・資料を選ぶ'));
    for (const target of game.investigationTargets) {
      const group = el('section', undefined, 'workspace-device'); group.append(el('h3', target.displayName));
      for (const item of materials.filter(item => item.targetId === target.targetId)) {
        const open = button(`${item.capabilities.console ? '▣' : '▤'} ${item.label}${item.collected ? '（保存済み）' : ''}`, () => {
          state.material = item.materialId; state.mode = 'source'; state.history = null; state.page = 0; state.command = ''; state.tool = null;
          if (!item.capabilities.console && !item.history.length) action('workspace-read', { materialId: item.materialId });
          else redraw();
        });
        open.dataset.materialId = item.materialId; group.append(open);
      }
      scene.append(group);
    }
    root.append(scene); return root;
  }
  const source = el('section', undefined, 'workspace-source');
  source.append(el('h2', material.label));
  const history = material.history;
  const selected = history[state.history ?? history.length - 1];
  const lines = selected?.output.split('\n') ?? [];
  const pageCount = Math.max(1, Math.ceil(lines.length / 25));
  state.page = Math.max(0, Math.min(state.page ?? 0, pageCount - 1));
  const consoleView = el('pre', selected ? lines.slice(state.page * 25, (state.page + 1) * 25).join('\n') || '該当する記録はありません。'
    : 'Templateからコマンドを挿入して実行してください。', 'workspace-console');
  consoleView.setAttribute('aria-label', material.capabilities.console ? 'Console' : '資料Viewer');
  consoleView.tabIndex = 0;
  source.append(consoleView);
  const paging = el('div', undefined, 'workspace-paging');
  paging.append(button('前ページ', () => { state.page--; redraw(); }, '', state.page === 0),
    el('span', `${state.page + 1} / ${pageCount}ページ · 結果 ${selected?.matchedRecords ?? 0} / 全 ${selected?.totalRecords ?? 0}件`),
    button('次ページ', () => { state.page++; redraw(); }, '', state.page + 1 >= pageCount));
  source.append(paging);
  const comparisons = el('div', undefined, 'workspace-comparisons');
  const filePairs = (game.workbench.comparisons ?? []).filter(pair =>
    [pair.damaged.materialId, pair.original.materialId].includes(material.materialId));
  for (const pair of filePairs) {
    const comparison = el('section', undefined, 'workspace-comparison');
    comparison.append(el('h3', `閲覧済みファイルの比較 — ${pair.originalPath}`));
    for (const [label, snapshot] of [['被害側', pair.damaged], ['正常版', pair.original]]) {
      comparison.append(el('p', `${label} / 行${snapshot.line}`),
        el('pre', `形式: ${snapshot.format}\nSHA-256: ${snapshot.sha256}\n先頭データ: ${snapshot.headerHex}`));
    }
    comparison.append(el('p', `ハッシュ: ${pair.hashChanged ? '異なる' : '一致'} / 先頭データ: ${pair.headerChanged ? '異なる' : '一致'}。この比較だけでは暗号化方式や操作者は特定できません。`));
    comparisons.append(comparison);
  }
  if (filePairs.length) source.append(comparisons);
  if (material.capabilities.console) {
    const composer = el('form', undefined, 'workspace-composer'); composer.setAttribute('aria-label', 'Command Composer');
    const label = el('label', 'Command Composer'); const input = el('input'); input.type = 'text'; input.value = state.command ?? '';
    input.setAttribute('aria-label', '疑似コマンド'); input.maxLength = 500;
    input.addEventListener('input', () => { state.command = input.value; }); label.append(input);
    const run = () => { const command = input.value; state.command = ''; state.history = null; state.page = 0;
      action('workspace-command', { materialId: material.materialId, command }); };
    composer.addEventListener('submit', event => { event.preventDefault(); run(); });
    const execute = button('実行', run); execute.type = 'button';
    composer.append(label, execute); source.append(composer);
  }
  const controls = el('div', undefined, 'workspace-tools');
  for (const [title, tool] of [['Template', 'templates'], ['保存値', 'values'], ['Help', 'help'], ['History', 'history'], ['原文の事実を証拠保存', 'facts']])
    controls.append(button(title, () => { state.tool = state.tool === tool ? null : tool; redraw(); }));
  source.append(controls);
  if (state.tool) {
    const overlay = el('section', undefined, 'workspace-overlay'); overlay.setAttribute('aria-label', '調査補助');
    overlay.append(button('閉じる', () => { state.tool = null; redraw(); }));
    const insert = command => { state.command = command; state.tool = null; redraw(); };
    if (state.tool === 'templates') for (const template of material.templates)
      overlay.append(button(`${template.label}: ${template.command}`, () => insert(template.command)));
    if (state.tool === 'help') overlay.append(el('p', game.workbench.help));
    if (state.tool === 'history') for (const [index, entry] of history.entries()) {
      overlay.append(button(entry.command, () => { state.history = index; state.page = 0; state.tool = null; redraw(); }),
        button(`再入力 ${index + 1}`, () => insert(entry.command)));
    }
    if (state.tool === 'values') {
      overlay.append(el('h3', '表示した原文から発見値を保存'));
      for (const observation of selected?.observations ?? []) overlay.append(button(`${observation.field}: ${observation.value}`, () =>
        action('save-observation', { materialId: material.materialId, ...observation })));
      overlay.append(el('h3', '事件内の保存値を検索へ挿入'));
      for (const entry of game.workbench.savedObservations) overlay.append(button(`${entry.value} — ${materials.find(item => item.materialId === entry.materialId)?.label}`, () =>
        insert(`grep -F ${JSON.stringify(entry.value)} material.txt`)));
    }
    if (state.tool === 'facts') {
      overlay.append(el('p', '原文にこの記録がある、という事実を保存します。記載内容の真実性や操作者についての推論とは区別します。'));
      for (const fact of material.facts) {
        const saved = material.savedFacts.some(item => item.line === fact.line);
        overlay.append(el('pre', `${fact.line}: ${fact.text}`), button(saved ? `行${fact.line} 保存済み` : `行${fact.line}を証拠として保存`, () =>
          action('save-fact', { materialId: material.materialId, line: fact.line }), '', saved));
      }
    }
    source.append(overlay);
  }
  root.append(source); return root;
}
