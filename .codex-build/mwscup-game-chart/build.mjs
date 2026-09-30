import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = "C:/Users/inuijura/Unity/MWSCup-B";
const SKILL_DIR = "C:/Users/inuijura/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations";
const TMP_DIR = path.join(workspaceDir, ".codex-build/mwscup-game-chart");
const FINAL_PPTX = path.join(workspaceDir, "output/MWSCup_ゲーム作品推移_編集可能_v2.pptx");
const RUNTIME_PYTHON = "C:/Users/inuijura/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";

const { applyPresentationChartFont, finalizePresentation } = await import(
  pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href,
);

const fontFamily = "Noto Sans JP";
const navy = "#18242F";
const blue = "#2563EB";
const gray = "#DCE3E8";
const muted = "#5C6B76";
const grid = "#D6DDE3";
const white = "#FFFFFF";

const presentation = Presentation.create({
  slideSize: { width: 1280, height: 720 },
});
const slide = presentation.slides.add();
slide.background.fill = white;

const title = slide.shapes.add({
  geometry: "textbox",
  position: { left: 68, top: 42, width: 1144, height: 62 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
title.text = "ゲーム形式の作品は2025年に急増";
title.text.style = {
  typeface: fontFamily,
  fontSize: 34,
  bold: true,
  color: navy,
  autoFit: "none",
};

const subtitle = slide.shapes.add({
  geometry: "textbox",
  position: { left: 70, top: 108, width: 900, height: 38 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
subtitle.text = "公開作品を網羅して確認できる2022～2025年を比較";
subtitle.text.style = {
  typeface: fontFamily,
  fontSize: 18,
  color: muted,
  autoFit: "none",
};

const chart = slide.charts.add("bar", {
  position: { left: 70, top: 168, width: 885, height: 405 },
  categories: ["2025", "2024", "2023", "2022"],
  series: [
    {
      name: "ゲーム形式",
      values: [9, 1, 0, 0],
      fill: blue,
      line: { fill: blue, width: 0 },
      dataLabelOverrides: [
        { idx: 0, showValue: true, position: "center", textStyle: { typeface: fontFamily, fontSize: 15, fill: white, bold: true } },
        { idx: 1, showValue: true, position: "center", textStyle: { typeface: fontFamily, fontSize: 15, fill: white, bold: true } },
        { idx: 2, showValue: false },
        { idx: 3, showValue: false },
      ],
    },
    { name: "その他", values: [9, 8, 12, 13], fill: gray, line: { fill: gray, width: 0 } },
  ],
  barOptions: { direction: "bar", grouping: "stacked", gapWidth: 55, overlap: 100 },
  hasLegend: true,
  legend: {
    position: "bottom",
    overlay: false,
    textStyle: { typeface: fontFamily, fontSize: 15, fill: navy },
  },
  xAxis: {
    visible: true,
    title: { text: "公開作品数（件）", textStyle: { typeface: fontFamily, fontSize: 15, fill: muted } },
    min: 0,
    max: 20,
    majorUnit: 5,
    numberFormatCode: "0",
    textStyle: { typeface: fontFamily, fontSize: 14, fill: muted },
    line: { fill: grid, width: 1 },
    majorGridlines: { fill: grid, width: 1 },
  },
  yAxis: {
    visible: true,
    textStyle: { typeface: fontFamily, fontSize: 17, fill: navy, bold: true },
    line: { fill: "#FFFFFF", width: 0 },
    majorGridlines: null,
  },
  dataLabels: {
    showValue: true,
    position: "center",
    textStyle: { typeface: fontFamily, fontSize: 15, fill: navy, bold: true },
    fill: "none",
    line: { fill: "none", width: 0 },
  },
  chartFill: white,
  chartLine: { fill: white, width: 0 },
  plotAreaFill: white,
  plotAreaLine: { fill: white, width: 0 },
});
applyPresentationChartFont(chart, { fontFamily });

const takeaway = slide.shapes.add({
  geometry: "textbox",
  position: { left: 980, top: 222, width: 240, height: 116 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
takeaway.text = "50%以上";
takeaway.text.style = {
  typeface: fontFamily,
  fontSize: 40,
  bold: true,
  color: blue,
  alignment: "center",
  autoFit: "none",
};

const takeawayBody = slide.shapes.add({
  geometry: "textbox",
  position: { left: 980, top: 326, width: 240, height: 98 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
takeawayBody.text = "2025年は少なくとも\n半数がゲーム形式";
takeawayBody.text.style = {
  typeface: fontFamily,
  fontSize: 20,
  bold: true,
  color: navy,
  alignment: "center",
  autoFit: "none",
};

const ratioLine = slide.shapes.add({
  geometry: "textbox",
  position: { left: 88, top: 580, width: 1110, height: 38 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
ratioLine.text = "ゲーム作品数／全公開作品数　2022：0／13　　2023：0／12　　2024：1／9　　2025：9以上／18";
ratioLine.text.style = {
  typeface: fontFamily,
  fontSize: 16,
  color: navy,
  alignment: "center",
  autoFit: "none",
};

const note = slide.shapes.add({
  geometry: "textbox",
  position: { left: 70, top: 642, width: 1140, height: 44 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
note.text = "注：タイトル・説明でゲーム形式を確認できた作品を保守的に集計。2020・2021年は全提出作品の内訳を確認できないため除外。";
note.text.style = {
  typeface: fontFamily,
  fontSize: 13,
  color: muted,
  autoFit: "none",
};

slide.speakerNotes.textFrame.setText(
  "出典：MWS Cup公式サイトおよび公式YouTubeプレイリスト。\n" +
  "2022 https://www.youtube.com/playlist?list=PL8oKzzuKda41qxRh4UEIr_EcgLeMQRAOg\n" +
  "2023 https://www.youtube.com/playlist?list=PL8oKzzuKda41aSgeoPKDX5g1iUNZvNgiC\n" +
  "2024 https://www.youtube.com/playlist?list=PL8oKzzuKda43Fp7xdklHuEBKeuEu4sf_v\n" +
  "2025 https://www.youtube.com/playlist?list=PL8oKzzuKda42npg-MS4P28JobQEoFuguT\n" +
  "判定基準：タイトルまたは説明にゲームと明記、あるいはMinecraft・カードゲーム等のゲーム形式、ミッション・勝敗・挑戦・報酬等の進行を確認できた作品。2025年は内容不明作品をゲーム数に含めず、下限値として9件を採用。"
);

const preview = await presentation.export({ slide, format: "png", scale: 1 });
await fs.writeFile(path.join(TMP_DIR, "slide-1.png"), new Uint8Array(await preview.arrayBuffer()));
const layout = await slide.export({ format: "layout" });
await fs.writeFile(path.join(TMP_DIR, "slide-1.layout.json"), await layout.text());

const requirements = {
  explicitTotalSlideCount: 1,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [1],
  requiredEmbeddedWorkbookChartOwnerSlides: [],
  materializeLiteralChartWorkbooks: true,
  nativeChartTargetApplication: "powerpoint",
};
const fontPolicy = { basis: "design", families: [fontFamily] };
const stagingDir = path.join(workspaceDir, ".codex-finalizer/mwscup-game-chart");
await fs.mkdir(stagingDir, { recursive: true });
await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
const candidatePath = path.join(stagingDir, "candidate.pptx");
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);

await finalizePresentation({
  ...requirements,
  workspaceDir,
  candidatePath,
  finalPath: FINAL_PPTX,
  pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: [
    "--expected-slide-size-emu", "12192000,6858000",
    "--validate-bullet-geometry",
    "--validate-heading-fit",
  ],
  requiredNativeTableOwnerSlides: [],
  fontPolicy,
  verifyArtifactToolImport: true,
  receiptPath: path.join(stagingDir, "MWSCup_ゲーム作品推移_編集可能_v2.pptx.validation.json"),
});

console.log(FINAL_PPTX);
