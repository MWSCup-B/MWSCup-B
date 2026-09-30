import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const names = ['scenario-generation-v1', 'scenario-revision-v1', 'scenario-verification-v1',
  'evidence-generation-v1', 'evidence-verification-v1'];
const prompts = new Map(await Promise.all(names.map(async name => [name,
  await readFile(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8')])));

for (const [name, prompt] of prompts) {
  test(`${name} keeps technical source materials and excludes player-visible investigation reports`, () => {
    assert.match(prompt, /Webページ本文.*ソース/);
    assert.match(prompt, /調査報告/);
    assert.match(prompt, /プレイヤー向け/);
    assert.doesNotMatch(prompt, /各entryにつき独立したDOCUMENTをちょうど1件作り/);
    assert.doesNotMatch(prompt, /調査報告と技術資料による人物対応を論証/);
  });
}

test('Evidence generation prohibits report artifacts while retaining non-log evidence types', () => {
  const prompt = prompts.get('evidence-generation-v1');
  assert.match(prompt, /ログに限定せず、メール、Webページ本文・保存ソース/);
  assert.match(prompt, /`CASE_FACT`、`IDENTITY_PROOF`、`caseSupport`、`caseReportCatalog`は生成対象にしません/);
  assert.doesNotMatch(prompt, /caseSupport\.observationQuote/);
  assert.doesNotMatch(prompt, /対応する報告の `observationQuote`/);
});

test('Evidence generation closes with all reviewed per-attack explanations', () => {
  const prompt = prompts.get('evidence-generation-v1');
  assert.match(prompt, /各攻撃の完結争点の審査済み`explanation`を順序どおり集約/);
  assert.match(prompt, /16,000文字以内/);
});

test('Credential phishing keeps the defined submission correlation and outcome fields', () => {
  const prompt = prompts.get('evidence-generation-v1');
  const instruction = prompt.split('\n').find(line => line.startsWith('- `credential_phishing`'));
  for (const field of ['source_page', 'request_id', 'destination', 'timestamp', 'correlation_id', 'result']) {
    assert.ok(instruction.includes(field), `Missing defined submission field: ${field}`);
  }
});

test('Scenario review uses only declared review references and never requires an observation report', () => {
  const prompt = prompts.get('scenario-verification-v1');
  assert.match(prompt, /allowedReviewRefs/);
  assert.match(prompt, /既存技術資料だけで検証/);
  assert.doesNotMatch(prompt, /CASE_FACT.*調査報告を.*取得/);
});
