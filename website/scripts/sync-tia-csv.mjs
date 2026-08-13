import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..", "..");
const sourceDir = resolve(projectRoot, "projects", "_PROJECT_TEMPLATE", "02-delay_analysis", "unified_tia_csv");
const publicDir = resolve(projectRoot, "website", "public", "tia-unified-csv");
const requiredCsvFiles = [
  "01_project_metadata.csv",
  "02_source_file_register.csv",
  "03_native_xer_pair_register.csv",
  "04_p6_activity_register.csv",
  "05_p6_relationship_register.csv",
  "06_delay_event_register.csv",
  "07_fragnet_activity_register.csv",
  "08_fragnet_relationship_register.csv",
  "09_before_after_fragnet_comparison.csv",
  "10_concurrency_entitlement_register.csv",
  "11_entitlement_evidence_register.csv",
  "12_delay_event_classification.csv",
  "13_tia_recovery_scenario.csv",
  "14_controlled_release_register.csv",
  "15_reconciliation_register.csv",
  "16_output_artifact_register.csv",
];

if (!existsSync(sourceDir)) {
  throw new Error(`Missing canonical local TIA CSV folder: ${sourceDir}`);
}

const sourceFiles = readdirSync(sourceDir).filter((name) => statSync(resolve(sourceDir, name)).isFile()).sort();
const unexpectedSourceFiles = sourceFiles.filter((name) => !requiredCsvFiles.includes(name));
const missingSourceFiles = requiredCsvFiles.filter((name) => !sourceFiles.includes(name));
if (unexpectedSourceFiles.length || missingSourceFiles.length) {
  throw new Error(
    `Canonical TIA CSV folder must contain exactly the 16 approved CSV files. Missing: ${missingSourceFiles.join(", ") || "none"}. Unexpected: ${unexpectedSourceFiles.join(", ") || "none"}.`,
  );
}

mkdirSync(publicDir, { recursive: true });
for (const name of readdirSync(publicDir)) {
  if (!requiredCsvFiles.includes(name)) {
    rmSync(resolve(publicDir, name), { recursive: true, force: true });
  }
}
for (const name of requiredCsvFiles) {
  copyFileSync(resolve(sourceDir, name), resolve(publicDir, name));
}

console.log(`Synced ${requiredCsvFiles.length} canonical TIA CSV templates to ${publicDir}`);
