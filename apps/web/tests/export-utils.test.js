const assert = require("node:assert/strict");
const test = require("node:test");

require("../export-utils.js");

const { buildExportFilename, slugifyProjectName } = globalThis.EoExportUtils;

test("slugifies project names into filesystem-safe identifiers", () => {
  assert.equal(slugifyProjectName("  Indus Basin / Crop Intelligence  "), "indus-basin-crop-intelligence");
  assert.equal(slugifyProjectName(""), "alphaearth");
});

test("builds deterministic project and date-stamped export filenames", () => {
  assert.equal(
    buildExportFilename({
      projectName: "Indus Basin",
      year: 2024,
      kind: "analysis package",
      extension: ".JSON",
      date: new Date("2026-07-20T12:00:00Z"),
    }),
    "indus-basin-2024-analysis-package-2026-07-20.json",
  );
});
