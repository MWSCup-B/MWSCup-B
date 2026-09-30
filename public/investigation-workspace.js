import { renderNetworkDiagram } from './network-diagram.js';

// View state is owned by one game render instance; saved data comes from its session.
export function renderInvestigationWorkspace(game, state, action, redraw, { el, button, submission, document }) {
  const root = el('section', undefined, 'investigation-workspace');
  const materials = game.workbench.materials;
  const material = materials.find(item => item.materialId === state.material);
  const mode = state.mode ?? 'scene';
  const switchMode = next => { state.previous = mode; state.mode = next; redraw(); };
  const toolbar = el('nav', undefined, 'workspace-toolbar');
  toolbar.setAttribute('aria-label', '調査モード');
  toolbar.append(button('現場へ戻る', () => { state.mode = 'scene'; state.tool = null; redraw(); }),
    button('Notes', () => switchMode('notes')), button('Talk', () => switchMode('talk')),
    button('Hint', () => switchMode('hint')),
    ...(game.networkDiagram ? [button('ネットワーク構成図', () => switchMode('network'))] : []),
    button('Report', () => switchMode('report')),
    button('保存した証拠を基に反論を考える', () => switchMode('submission'), '',
      !(game.workbench.canChooseEvidence ?? materials.some(item => item.collected))));
  const progress = game.workbench.progress;
  const savedLineCount = materials.reduce((total, item) => total + (item.savedFacts?.length ?? 0), 0);
  const savedMaterialCount = materials.filter(item => item.collected || (item.savedFacts?.length ?? 0) > 0).length;
  const progressStatus = el('div', undefined, 'workspace-progress-status');
  progressStatus.append(
    el('span', `${progress.complete ? '必要資料の保存完了' : '今回の争点に必要な資料'} ${progress.collected} / ${progress.required}`, 'workspace-required-count'),
    el('span', `保存済み原文 ${savedLineCount} 行 / ${savedMaterialCount} 資料`, 'workspace-saved-count'));
  toolbar.append(progressStatus);
  toolbar.append(button('保存した証拠をすべて取り消す', () => {
    action('clear-saved-evidence');
  }, 'workspace-clear-saved-evidence', savedMaterialCount === 0));
  root.append(toolbar, el('p', '資料を開いただけでは原文は保存されません。「原文を証拠として保存」を押すと、保存済み原文の件数に反映されます。上段の進捗は今回の争点で必要な資料だけを数えるため、別の争点で使う資料を保存しても増えません。調査回が切り替わると保存状況はリセットされます。', 'workspace-progress-help'));
  if (mode === 'submission') { root.append(submission()); return root; }
  if (['notes', 'talk', 'hint', 'network', 'report'].includes(mode)) {
    const page = el('section', undefined, 'workspace-auxiliary');
    page.append(button('直前の調査へ戻る', () => { state.mode = state.resume ?? 'scene'; redraw(); }));
    if (mode === 'notes') {
      page.append(el('h2', '検索用メモ（証拠ではありません）'));
      for (const entry of game.workbench.savedObservations) page.append(el('p', `${entry.field}: ${entry.value} — ${materials.find(item => item.materialId === entry.materialId)?.label}`));
      page.append(el('h2', '保存した証拠（原文の記録）'));
      for (const source of materials) for (const fact of source.savedFacts) page.append(el('p', `${source.label} / 行${fact.line}: ${fact.text}`));
    } else if (mode === 'talk') {
      page.append(el('h2', '検察側の主張'), el('p', game.investigationClaim?.spokenContent ?? '資料を照合してください。'));
    } else if (mode === 'hint') {
      const storedXss = materials.some(item => item.label.includes('ブラウザ通信の開始元記録'));
      const hints = storedXss ? [
        'Hint1：まず、投稿を保存した記録、投稿を表示した要求、ブラウザでの実行記録を区別しましょう。保存されたことだけでは、誰が投稿を作成したかや、閲覧時にスクリプトが実行されたかまでは分かりません。',
        'Hint2：ブラウザの動作記録では、閲覧要求のrequest_id、対象投稿のpost_id、execution_id、実行結果を確認します。通信の開始元記録では、view_request_id、source_post_id、execution_id、initiator_type、source_locationを見て、同じ投稿・閲覧・実行の記録か照合します。',
        'Hint3：投稿の保存記録と閲覧・実行記録で、post_id、要求ID、execution_idなどが対応しているか確かめましょう。保存内容、実行結果、通信の開始元を合わせて読むと、投稿が保存された段階と、閲覧後に発生した処理を区別できます。ログに記録された利用者や端末だけから、投稿の作成者本人まで断定しないでください。',
      ] : [
        'Hint1：まず、各資料に実際に記録された事実と、検察側がそこから導いた解釈を分けてください。IPアドレスやアカウントの一致だけでは、操作した人物までは特定できません。',
        'Hint2：同じ時間帯の複数資料を照合し、送信元・送信先・相関ID・処理結果が対応しているか確認してください。一つの資料だけで、入力が処理へ至った経路や、記録上の実行主体を断定しないことが重要です。',
        `Hint3：この争点では、必要な記録が ${progress.required} 件あります。検察側の直接操作説と、別の攻撃経路のどちらが記録全体と矛盾なく整合するかを検討してください。`,
      ];
      state.hintLevel = Math.max(1, Math.min(state.hintLevel ?? 1, hints.length));
      page.append(el('h2', '調査のHint'));
      for (const hint of hints.slice(0, state.hintLevel)) page.append(el('p', hint));
      if (state.hintLevel < hints.length) page.append(button('次のHintを表示', () => { state.hintLevel += 1; redraw(); }));
    } else if (mode === 'network') {
      page.append(el('h2', 'ネットワーク構成図'));
      const scroll = el('div', undefined, 'workspace-network-scroll');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'network-diagram');
      renderNetworkDiagram(svg, game.networkDiagram, document);
      scroll.append(svg); page.append(scroll);
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
        const sourceSuffix = ` — ${target.displayName}`;
        const materialName = item.label.endsWith(sourceSuffix) ? item.label.slice(0, -sourceSuffix.length) : item.label;
        const open = button(`${item.capabilities.console ? '▣' : '▤'} ${materialName}${item.collected ? '（保存済み）' : ''}`, () => {
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
  for (const [title, tool] of [['Template', 'templates'], ['保存値', 'values'], ['Help', 'help'], ['History', 'history'], ['原文を証拠として保存', 'facts']])
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
      overlay.append(el('h3', '原文から検索用の値を保存'));
      for (const observation of selected?.observations ?? []) overlay.append(button(`${observation.field}: ${observation.value}`, () =>
        action('save-observation', { materialId: material.materialId, ...observation })));
      overlay.append(el('h3', '保存した値を検索欄へ挿入'));
      for (const entry of game.workbench.savedObservations) overlay.append(button(`${entry.value} — ${materials.find(item => item.materialId === entry.materialId)?.label}`, () =>
        insert(`grep -F ${JSON.stringify(entry.value)} material.txt`)));
    }
    if (state.tool === 'facts') {
      const lineCount = Number.isInteger(material.lineCount) ? material.lineCount : material.facts.length;
      overlay.append(el('p', '現在表示している絞り込み結果から行を個別に保存するか、選択中の資料の原文全行を一括保存します。記載内容が真実かどうかや、実際の操作者についての推論とは区別してください。'));
      overlay.append(button(material.allFactsSaved
        ? `この資料の全${lineCount}行は保存済み`
        : `この資料の全${lineCount}行を一括保存`,
      () => action('save-all-facts', { materialId: material.materialId }),
      'workspace-save-all-facts', material.allFactsSaved || lineCount === 0));
      const visibleLines = new Set(selected?.lines ?? []);
      const visibleFacts = material.facts.filter(fact => visibleLines.has(fact.line));
      if (!visibleFacts.length) overlay.append(el('p', '現在の表示結果には、保存できる原文行がありません。絞り込み条件または表示履歴を確認してください。'));
      for (const fact of visibleFacts) {
        const saved = material.savedFacts.some(item => item.line === fact.line);
        overlay.append(el('pre', `${fact.line}: ${fact.text}`), button(saved ? `行${fact.line}の保存を取り消す` : `行${fact.line}を証拠として保存`, () =>
          action(saved ? 'remove-fact' : 'save-fact', { materialId: material.materialId, line: fact.line })));
      }
    }
    source.append(overlay);
  }
  root.append(source); return root;
}
