const fs = require('fs');
const path = require('path');

/**
 * Recursively collects every `chapter_*.yaml` file under `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
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

module.exports = {
  walkChapterFiles,
  findCodeSpans,
  renderCodeBlock,
};
