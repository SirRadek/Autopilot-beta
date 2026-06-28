import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderCompositionPage } from "./render-composition";
import { assertRootColorContrastWcagAA } from "./wcag-contrast";

const repoRoot = process.cwd();
const pdosRoot = path.join(repoRoot, "product-design-os");
const specPath = path.join(pdosRoot, "specs", "examples", "local-bricklayer.composition.json");
const outputDir = path.join(repoRoot, "output", "render");
const outputPath = path.join(outputDir, "local-bricklayer-trial.html");

const result = renderCompositionPage(readJson(specPath), pdosRoot);
const contrastPairs = assertRootColorContrastWcagAA(result.html);
const imgCount = countOccurrences(result.html, "<img ");
const loraFontLinkPresent = result.html.includes("https://fonts.googleapis.com/css2?family=Lora:wght@400;700&amp;display=swap");
const contractFailures = result.sections.filter((section) => section.contractErrors.length > 0);

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, result.html, "utf8");

console.log(`Rendered ${path.relative(repoRoot, outputPath).replace(/\\/g, "/")}`);
console.log(`Sections: ${result.sections.length}`);
for (const section of result.sections) {
  const errors = section.contractErrors.map((issue) => issue.code).join(", ") || "0";
  console.log(`- ${section.node_id} (${section.pattern_id}): contract errors ${errors}`);
}
console.log(`WCAG-AA: ${contrastPairs.map((pair) => `${pair.pair} ${pair.ratio.toFixed(2)}:1`).join(", ")}`);
console.log(`Images: ${imgCount}`);
console.log(`Lora font link present: ${loraFontLinkPresent}`);

if (contractFailures.length > 0) {
  throw new Error(
    `Zednik trial contract failures: ${contractFailures
      .map((section) => `${section.node_id}:${section.contractErrors.map((issue) => issue.code).join(",")}`)
      .join("; ")}`
  );
}

if (imgCount < 1) {
  throw new Error("Zednik trial did not render a proof image.");
}

if (!loraFontLinkPresent) {
  throw new Error("Zednik trial did not render the Lora font link.");
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
