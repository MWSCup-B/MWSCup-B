# ペンギン人物素材

使用スキル: `imagegen`。組込み画像生成ツールで参照画像から編集・派生生成。参照は `image/pengin.png`。透過PNG、全身、中央配置。既存の盾と文字を取り除き、役割の衣装と小物を追加した。

| 役 | 保存先 | 役別プロンプト |
| --- | --- | --- |
| 裁判官 | `public/assets/characters/judge-penguin-v1.png` | 裁判官。黒い法服と白い襟、小さな木槌、落ち着いた厳正な表情。 |
| 検察官 | `public/assets/characters/prosecutor-penguin-v1.png` | 検察官。えんじ色のスーツ、白いシャツ、手に事件ファイル、自信のある表情。 |
| 弁護士 | `public/assets/characters/defense-penguin-v1.png` | 弁護士。紺色のスーツ、青いネクタイ、小さな書類を手にし、頼もしい表情。 |
| 助手 | `public/assets/characters/assistant-penguin-v1.png` | 調査助手。青緑色のベスト、白いシャツ、小さなノートを手にし、親しみやすい好奇心のある表情。 |

共通プロンプト（`${detail}`へ上表の役別プロンプトを挿入）:

```text
Use case: identity-preserve. Asset type: original game character sprite, transparent PNG. Reference image: provided image/pengin.png is the original mascot and identity reference. Create one ${detail} 原型の丸い青灰色のペンギン、小さな頭の羽毛、淡い白青の顔とお腹、黄色いくちばしと足、黒くきりっとした目、シンプルで手描き感のある輪郭と平面的な塗りを忠実に維持する。盾とGUARD文字は取り除く。人間にしない。全身、正面に近い向き、中央配置、足や頭を切らず、周囲に余白。背景は本当に透明。文字・名前・ロゴ・背景・他の人物・フレーム・影の床は描かない。元画像の独自デザインを保ち、既存作品の人物や衣装を複製しない。
```
