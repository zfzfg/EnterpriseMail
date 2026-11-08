import { existsSync } from "node:fs";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(uiRoot, "..");
const staticRoot = resolve(repoRoot, "snappymail/v/0.0.0/static");
const outputRoot = resolve(repoRoot, "build/local/bundle");
const baselinePath = resolve(uiRoot, "scripts/bundle-baseline.json");
const args = new Set(process.argv.slice(2));
const supportedArgs = new Set(["--check", "--write-baseline"]);

for (const arg of args) {
  if (!supportedArgs.has(arg)) {
    throw new Error(`Unknown argument: ${arg}`);
  }
}
if (args.has("--check") && args.has("--write-baseline")) {
  throw new Error("--check and --write-baseline are mutually exclusive");
}

const definitions = [
  { name: "app.js", directory: "js", metafile: "app.meta.json" },
  { name: "admin.js", directory: "js", metafile: "admin.meta.json" },
  { name: "app.css", directory: "css" },
  { name: "admin.css", directory: "css" }
];

const portablePath = (path) => path.replaceAll("\\", "/");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const baseline = readJson(baselinePath);

function summarizeMetafile(name, filename) {
  const path = resolve(repoRoot, "build/local/esbuild", filename);
  if (!existsSync(path)) {
    throw new Error(`Missing ${portablePath(relative(repoRoot, path))}; run npm run build:js first`);
  }

  const metafile = readJson(path);
  const output = Object.entries(metafile.outputs ?? {}).find(([outputPath]) =>
    portablePath(outputPath).endsWith(`/static/js/${name}`)
  );
  if (!output) {
    throw new Error(`Metafile ${filename} has no output for ${name}`);
  }

  const inputs = Object.entries(output[1].inputs ?? {})
    .map(([inputPath, details]) => ({
      path: portablePath(inputPath),
      bytesInOutput: details.bytesInOutput
    }))
    .sort((a, b) => b.bytesInOutput - a.bytesInOutput || a.path.localeCompare(b.path));

  return {
    path: portablePath(relative(repoRoot, path)),
    inputCount: inputs.length,
    largestInputs: inputs.slice(0, 10)
  };
}

const publicMaps = readdirSync(resolve(staticRoot, "js"))
  .filter((name) => name.endsWith(".map"))
  .sort();
if (publicMaps.length > 0) {
  throw new Error(`Public source maps are not allowed: ${publicMaps.join(", ")}`);
}

const artifacts = definitions.map(({ name, directory, metafile }) => {
  const path = resolve(staticRoot, directory, name);
  const contents = readFileSync(path);
  if (directory === "js" && contents.includes(Buffer.from("sourceMappingURL="))) {
    throw new Error(`${name} contains a source map reference`);
  }

  return {
    name,
    rawBytes: contents.length,
    gzipBytes: gzipSync(contents, { level: 9, mtime: 0 }).length,
    ...(metafile ? { metafile: summarizeMetafile(name, metafile) } : {})
  };
});

const report = {
  schemaVersion: 1,
  compression: "gzip-9",
  publicSourceMaps: false,
  artifacts
};

function markdown(report) {
  const lines = [
    "# Bundle size report",
    "",
    "Gzip uses level 9. Reports contain no timestamps or absolute paths.",
    "",
    "| Artifact | Raw bytes | Gzip bytes | Metafile inputs |",
    "| --- | ---: | ---: | ---: |",
    ...report.artifacts.map((artifact) =>
      `| ${artifact.name} | ${artifact.rawBytes} | ${artifact.gzipBytes} | ${artifact.metafile?.inputCount ?? "—"} |`
    )
  ];

  for (const artifact of report.artifacts.filter((item) => item.metafile)) {
    lines.push("", `## ${artifact.name}: largest inputs`, "", "| Input | Bytes in output |", "| --- | ---: |");
    for (const input of artifact.metafile.largestInputs) {
      lines.push(`| ${input.path} | ${input.bytesInOutput} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function checkBudget(report) {
  const growth = baseline.allowedGrowthPercent;
  if (typeof growth !== "number" || growth < 0) {
    throw new Error("bundle-baseline.json requires a non-negative allowedGrowthPercent");
  }

  const failures = [];
  for (const artifact of report.artifacts) {
    const reference = baseline.artifacts?.[artifact.name];
    if (!reference) {
      failures.push(`${artifact.name}: no baseline entry`);
      continue;
    }
    for (const metric of ["rawBytes", "gzipBytes"]) {
      const limit = Math.ceil(reference[metric] * (1 + growth / 100));
      if (artifact[metric] > limit) {
        failures.push(
          `${artifact.name} ${metric}: ${artifact[metric]} exceeds ${reference[metric]} + ${growth}% (limit ${limit})`
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Bundle budget failed:\n- ${failures.join("\n- ")}\n` +
      "Review the metafiles; after an intentional change, run npm run bundle:baseline and review that diff."
    );
  }
  console.log(`Bundle budgets passed (maximum growth: ${growth}%).`);
}

mkdirSync(outputRoot, { recursive: true });
writeFileSync(resolve(outputRoot, "bundle-sizes.json"), `${JSON.stringify(report, null, 2)}\n`);
const rendered = markdown(report);
writeFileSync(resolve(outputRoot, "bundle-sizes.md"), rendered);
console.log(rendered);

if (args.has("--write-baseline")) {
  const nextBaseline = {
    schemaVersion: 1,
    allowedGrowthPercent: baseline.allowedGrowthPercent ?? 2,
    source: "Deliberately updated with npm run bundle:baseline.",
    artifacts: Object.fromEntries(
      report.artifacts.map(({ name, rawBytes, gzipBytes }) => [name, { rawBytes, gzipBytes }])
    )
  };
  writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
  console.log(`Updated ${portablePath(relative(repoRoot, baselinePath))}; review this intentional baseline change.`);
} else if (args.has("--check")) {
  checkBudget(report);
}
