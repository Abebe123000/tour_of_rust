/**
 * One-time migration: rewrites `code:` fields in lessons/<lang>/chapter_*.yaml
 * that hold a Rust Playground share URL referencing a `gist=<id>` into the
 * raw Rust source, fetched from Playground's public gist API
 * (https://play.rust-lang.org/meta/gist/<id>), so that `git diff` on these
 * files shows readable code diffs instead of an opaque gist id that never
 * changes even when the referenced gist's content does (see issue #13, a
 * follow-up to #9/#12).
 *
 * Entries using the `code=` param are already migrated (see
 * migrate-playground-code.js) and are left untouched here, as are entries
 * that don't match the expected `gist=` URL shape at all.
 *
 * Usage:
 *   node scripts/migrate-gist-code.js --dry-run   # fetch + report only, no file writes
 *   node scripts/migrate-gist-code.js              # fetch gists and rewrite files
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { parsePlaygroundUrl, DEFAULT_EDITION } = require('./lib/playground');
const { walkChapterFiles, findCodeSpans, renderCodeBlock } = require('./lib/code-block');

const LESSONS_ROOT = path.join(__dirname, '..', 'lessons');
const DRY_RUN = process.argv.includes('--dry-run');
const GIST_API_ORIGIN = 'https://play.rust-lang.org/meta/gist/';

const gistCodeCache = new Map();

/**
 * @param {string} gistId
 * @returns {Promise<string>} the gist's raw Rust source
 */
async function fetchGistCode(gistId) {
  if (gistCodeCache.has(gistId)) return gistCodeCache.get(gistId);
  const res = await fetch(`${GIST_API_ORIGIN}${gistId}`);
  if (!res.ok) {
    throw new Error(`gist ${gistId}: request failed with HTTP ${res.status}`);
  }
  const body = await res.json();
  if (typeof body.code !== 'string') {
    throw new Error(`gist ${gistId}: response had no 'code' field`);
  }
  gistCodeCache.set(gistId, body.code);
  return body.code;
}

async function migrateFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const usesCRLF = original.includes('\r\n');
  const normalized = usesCRLF ? original.replace(/\r\n/g, '\n') : original;
  const lines = normalized.split('\n');
  const parsed = yaml.load(original);
  if (!Array.isArray(parsed)) return { filePath, migrated: 0, skipped: 0 };

  const entriesWithCode = parsed.filter((e) => e && typeof e.code === 'string');
  const spans = findCodeSpans(lines);

  if (entriesWithCode.length !== spans.length) {
    throw new Error(
      `${filePath}: found ${spans.length} 'code:' line(s) in raw text but ${entriesWithCode.length} entries with a code field when parsed — refusing to migrate this file automatically.`,
    );
  }

  let migrated = 0;
  let skipped = 0;
  const replacements = [];

  for (let i = 0; i < spans.length; i += 1) {
    const entry = entriesWithCode[i];
    const span = spans[i];
    const parsedUrl = parsePlaygroundUrl(entry.code);
    if (parsedUrl && parsedUrl.gist) {
      // Sequential on purpose: keeps load on play.rust-lang.org light and
      // makes a failing gist id easy to attribute in the error output.
      // eslint-disable-next-line no-await-in-loop
      const rawCode = await fetchGistCode(parsedUrl.gist);
      const edition = parsedUrl.edition ? Number(parsedUrl.edition) : DEFAULT_EDITION;
      let block = renderCodeBlock(rawCode, span.keyIndent, span.contentIndent);
      if (edition !== DEFAULT_EDITION) {
        block += `\n${span.keyIndent}edition: ${edition}`;
      }
      replacements.push({ span, block });
      migrated += 1;
    } else {
      // code=, or something we don't recognize: leave untouched
      skipped += 1;
    }
  }

  if (migrated === 0) {
    return { filePath, migrated, skipped };
  }

  // Apply replacements back-to-front so earlier line indices stay valid.
  const newLines = lines.slice();
  replacements
    .slice()
    .reverse()
    .forEach(({ span, block }) => {
      newLines.splice(span.start, span.end - span.start + 1, ...block.split('\n'));
    });
  const newContent = newLines.join(usesCRLF ? '\r\n' : '\n');

  // Sanity check: the migrated file must still be valid YAML, and every
  // untouched field must parse identically to before.
  const reparsed = yaml.load(newContent);
  if (!Array.isArray(reparsed) || reparsed.length !== parsed.length) {
    throw new Error(`${filePath}: migrated file failed to reparse as an equivalent array`);
  }

  if (!DRY_RUN) {
    fs.writeFileSync(filePath, newContent);
  }

  return { filePath, migrated, skipped };
}

async function main() {
  const files = walkChapterFiles(LESSONS_ROOT);
  let totalMigrated = 0;
  let totalSkipped = 0;
  let filesChanged = 0;
  const errors = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const file of files) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await migrateFile(file);
      if (result.migrated > 0) filesChanged += 1;
      totalMigrated += result.migrated;
      totalSkipped += result.skipped;
    } catch (e) {
      errors.push(e.message);
    }
  }

  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}Migrated ${totalMigrated} gist= entries across ${filesChanged} files `
      + `(left ${totalSkipped} code=/other entries untouched), fetching ${gistCodeCache.size} unique gist id(s).`,
  );
  if (errors.length) {
    console.log(`\n${errors.length} file(s) raised errors and were left untouched:`);
    errors.forEach((e) => console.log(`- ${e}`));
    process.exitCode = 1;
  }
}

main();
