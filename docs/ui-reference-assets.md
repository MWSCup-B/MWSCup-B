# UI参考画像と生成素材

## 2026-09-21 追加素材

タイトルは利用者指定の `image/title.png` を加工せず `public/assets/title/title.png` へコピーして使用する。`image/選択肢.png` は証拠カード・選択状態・資料枠のHTML/CSSの参考とし、描き込まれた見本のUSBや鍵をゲームの証拠に追加しない。

助手は組み込み `image_gen` ツール（`imagegen` スキル）で `image/助手.png` から抽出し、透過PNGを `public/assets/characters/assistant-portrait-v1.png` に保存した。会話と名前札はHTMLで表示する。

最終プロンプト：

```text
Use case: background-extraction. Asset type: transparent character sprite for an investigation adventure web game. Image 1 is the user-provided edit target. Extract only the foreground female assistant, preserving her illustrated identity: brown ponytail, brown eyes, light gray blazer, white blouse, small gold lapel badge, thoughtful pose with hand near chin and leaning forward. Preserve face, clothes, cel-shaded anime rendering and lighting. One waist-up person, entire head, hair and arms inside frame. Actual transparent alpha background. Remove all scenery, shelves, furniture, USB, evidence card, all UI, nameplate, words, letters and watermark. No new objects or characters. Production-ready transparent PNG.
```

## 既存素材

2026-09-21。利用者指定の`image/`内の5枚を参照。紺・金の資料パネル、青い話者名札、木目の法廷、夜の調査室をUIへ反映した。参考画像の台詞、名前、USB等の証拠、有罪表示はゲームデータとして取り込まない。判決はBackendの実際の状態から表示する。

`imagegen`スキルの組み込みimage_genツールを使用。PNGは実際に生成し、人物のalphaチャンネルを保持したままコピーした。原画像は変更しない。クリック可能なUIや台詞はHTML/CSSで構築し、背景へ焼き込まない。背景に人物を含めず、話者1人だけを重ねる。旧SVGは互換用に保持する。

## 保存先と最終プロンプト

### defense-portrait-v2.png

保存先：`public/assets/characters/defense-portrait-v2.png`

参照：`image/ChatGPT Image 2026年9月20日 23_50_09.png`

```text
Use case: background-extraction. Asset type: transparent character sprite for a courtroom adventure web game. Image 1 is the user-provided reference/edit target. Extract only the foreground male defense lawyer: short dark hair, black rectangular glasses, navy suit, blue tie, small gold lapel pin, holding a plain brown case folder and making a measured pointing gesture. Preserve his illustrated face, hairstyle, clothes, cel-shaded anime rendering and warm light. Waist-up portrait with the entire head and gesturing hand inside frame, adequate transparent margins, no cropped fingers. Genuinely transparent alpha background. Remove the courtroom, judge, all other people, desk, microphone, all UI, dialogue, nameplate, symbols, text and watermark. Only ONE person. No new names, logos, words or evidence. Production ready PNG sprite.
```

### prosecutor-portrait-v2.png

保存先：`public/assets/characters/prosecutor-portrait-v2.png`

参照：`image/ChatGPT Image 2026年9月20日 23_50_01.png`

```text
Use case: background-extraction. Asset type: transparent character sprite for a courtroom adventure web game. Image 1 is the user-provided reference/edit target. Extract only the foreground male prosecutor: short light-brown hair, neat beard, burgundy suit, white shirt, charcoal tie, stern expression and open palm as he makes an argument. Preserve his illustrated face, hairstyle, clothes, cel-shaded anime rendering and warm light. Waist-up portrait with entire head and gesturing hand inside frame, adequate transparent margins, no cropped fingers. Genuinely transparent alpha background. Remove the courtroom, judge, all other people, desk, microphone, all UI, dialogue, nameplate, symbols, text and watermark. Only ONE person. No new names, logos, words or evidence. Production ready PNG sprite.
```

### courtroom-v2.png

保存先：`public/assets/backgrounds/courtroom-v2.png`

参照：`image/ChatGPT Image 2026年9月20日 23_50_01.png`、`image/ChatGPT Image 2026年9月20日 23_50_41.png`

```text
Use case: stylized-concept. Asset type: empty game environment background, wide 16:9. Image 1 and Image 2 are user-provided style and architecture references, NOT screenshots to reproduce. Create a clean empty wood-paneled courtroom matching their warm amber lighting, polished wooden benches and columns, blue drapery, understated brass balance-scale wall emblem. Eye-level view from counsel desk toward the empty judge bench with a clear central stage for a separately composited waist-up character. Detailed anime visual-novel background, sharp readable environment, restrained dramatic atmosphere. No people, no silhouettes, no UI, no dialogue, no nameplates, no evidence objects, no letters, no numbers, no words, no logos, no watermarks. Background only.
```

### investigation-v2.png

保存先：`public/assets/backgrounds/investigation-v2.png`

参照：`image/ChatGPT Image 2026年9月20日 23_45_35.png`

```text
Use case: stylized-concept. Asset type: empty game investigation-room environment background, wide 16:9. Image 1 is the user-provided style and room reference, NOT a screenshot to reproduce. Create an empty records office at evening: blue-lit window blinds, archival shelves with unmarked boxes, wooden desk, warm brass desk lamp, papers without readable markings. Same detailed cel-shaded anime environmental art and restrained blue/gold lighting as reference. Clear center foreground for a separately composited waist-up lawyer. Remove all characters. No USB or highlighted clue, no evidence popups, no UI, no dialogue or buttons, no nameplates, no readable text, no letters/numbers/logos, no watermark. Background only.
```
