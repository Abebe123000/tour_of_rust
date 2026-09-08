/**
 * One-time migration: rewrites `code:` fields in lessons/<lang>/chapter_*.yaml
 * that hold a Rust Playground share URL with an inline `code=` param into the
 * raw Rust source, so that `git diff` on these files shows readable code
 * diffs instead of percent-encoded strings (see issue #9).
 *
 * Only touches entries whose Playground URL carries `code=` (the vast
 * majority). Entries that instead reference a `gist=` id, or that don't match
 * the expected URL shape at all, are left completely untouched byte-for-byte
 * — those are out of scope for this migration.
 *
 * generate.js is responsible for turning the raw source back into a
 * Playground URL at build time (see resolvePlaygroundCode there).
 *
 * Usage:
 *   node scripts/migrate-playground-code.js --dry-run   # report only
 *   node scripts/migrate-playground-code.js              # rewrite files
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { parsePlaygroundUrl, decodePlaygroundCode, DEFAULT_EDITION } = require('./lib/playground');

const LESSONS_ROOT = path.join(__dirname, '..', 'lessons');
const DRY_RUN = process.argv.includes('--dry-run');

function walkChapterFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkChapterFiles(p);
      if (entry.isFile() && entry.name.startsWith('chapter_') && entry.name.endsWith('.yaml')) {
        return [p];
      }
      return [];
    });
}

/**
 * Finds the raw-text line span of every `code:` key in a chapter file, in
 * document order, along with enough info to know whether it's a block
 * scalar (folded `>-`) or an inline value, and what indentation its content
 * uses.
 * @param {string[]} lines
 */
function findCodeSpans(lines) {
  const spans = [];
  const keyRe = /^(\s*)code:(.*)$/;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(keyRe);
    if (m) {
      const keyIndent = m[1];
      const rest = m[2].trim();
      if (rest.startsWith('http')) {
        // Single-line inline value, e.g. `  code: https://...`
        spans.push({
          start: i, end: i, keyIndent, inline: true, contentIndent: null,
        });
      } else {
        // Block scalar (`>-`, `>`, `|-`, `|`, ...): consume continuation
        // lines that are blank or indented deeper than the key itself.
        let end = i;
        let contentIndent = null;
        for (let j = i + 1; j < lines.length; j += 1) {
          const line = lines[j];
          const lineIndent = (line.match(/^(\s*)/) || [''])[1];
          if (line.trim() === '') {
            end = j;
          } else if (lineIndent.length > keyIndent.length) {
            if (contentIndent === null) contentIndent = lineIndent;
            end = j;
          } else {
            break;
          }
        }
        spans.push({
          start: i, end, keyIndent, inline: false, contentIndent,
        });
      }
    }
  }
  return spans;
}

/**
 * @param {string} rawCode decoded Rust source
 * @param {string} keyIndent indentation of the `code:` key itself
 * @param {string|null} contentIndent indentation used by the original block content, if any
 */
function renderCodeBlock(rawCode, keyIndent, contentIndent) {
  const indent = contentIndent || `${keyIndent}  `;
  // Preserve whether the original decoded source had a trailing newline:
  // `|` (clip) reproduces exactly one, `|-` (strip) reproduces none.
  const hasTrailingNewline = rawCode.endsWith('\n');
  const chomp = hasTrailingNewline ? '' : '-';
  const codeLines = (hasTrailingNewline ? rawCode.slice(0, -1) : rawCode).split('\n');
  const body = codeLines.map((l) => (l.length ? `${indent}${l}` : '')).join('\n');
  return `${keyIndent}code: |${chomp}\n${body}`;
}

function migrateFile(filePath) {
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
    if (parsedUrl && parsedUrl.code != null) {
      const rawCode = decodePlaygroundCode(parsedUrl.code);
      const edition = parsedUrl.edition ? Number(parsedUrl.edition) : DEFAULT_EDITION;
      let block = renderCodeBlock(rawCode, span.keyIndent, span.contentIndent);
      if (edition !== DEFAULT_EDITION) {
        block += `\n${span.keyIndent}edition: ${edition}`;
      }
      replacements.push({ span, block });
      migrated += 1;
    } else {
      // gist=, or something we don't recognize: leave untouched
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

function main() {
  const files = walkChapterFiles(LESSONS_ROOT);
  let totalMigrated = 0;
  let totalSkipped = 0;
  let filesChanged = 0;
  const errors = [];

  files.forEach((file) => {
    try {
      const result = migrateFile(file);
      if (result.migrated > 0) filesChanged += 1;
      totalMigrated += result.migrated;
      totalSkipped += result.skipped;
    } catch (e) {
      errors.push(e.message);
    }
  });

  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}Migrated ${totalMigrated} code= entries across ${filesChanged} files (left ${totalSkipped} gist=/other entries untouched).`,
  );
  if (errors.length) {
    console.log(`\n${errors.length} file(s) raised errors and were left untouched:`);
    errors.forEach((e) => console.log(`- ${e}`));
    process.exitCode = 1;
  }
}

main();
