/**
 * Copies the pdf.js decoders, CMaps, standard fonts and ICC profiles into
 * public/pdfjs so the browser reader can decode every PDF it is given:
 * CCITT / JBIG2 scans (the usual office-scanner letter), JPEG 2000 images,
 * CID-keyed Asian fonts and non-embedded standard fonts. Runs before dev and
 * build so the files always match the installed pdfjs-dist version.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("pdfjs-dist/package.json"));
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "pdfjs");

rmSync(target, { recursive: true, force: true });
for (const folder of ["wasm", "cmaps", "standard_fonts", "iccs"]) {
  const from = join(root, folder);
  if (!existsSync(from)) throw new Error(`pdfjs-dist has no ${folder} folder — the PDF reader would not decode scans`);
  mkdirSync(join(target, folder), { recursive: true });
  // Form scripting (QuickJS) is never enabled by the reader.
  cpSync(from, join(target, folder), { recursive: true, filter: (path) => !/quickjs/i.test(path) });
}
console.log(`pdf.js assets copied to ${target}`);
