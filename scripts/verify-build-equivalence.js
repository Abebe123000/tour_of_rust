/**
 * Compares two generated `docs/` build outputs (e.g. before/after a
 * generate.js or lessons/*.yaml change) and asserts that:
 *
 *   1. the same set of HTML files was produced, and
 *   2. every file is byte-identical once each Rust Playground iframe URL is
 *      normalized to its decoded source code (so cosmetic differences in the
 *      URL's percent-encoding don't cause false positives), and
 *   3. every Playground URL pair decodes to the exact same Rust source
 *      (this is the actual regression we care about).
 *
 * Usage: node scripts/verify-build-equivalence.js <old-dir> <new-dir>
 */
const fs = require('fs');
const path = require('path');
const { parsePlaygroundUrl, decodePlaygroundCode } = require('./lib/playground');

const PLAYGROUND_URL_RE = /https:\/\/play\.rust-lang\.org\/\?[^"]*/g;
const PLACEHOLDER = '__PLAYGROUND_URL__';

function listHtmlFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.html'))
    .map((d) => d.name)
    .sort();
}

function normalize(content) {
  return content.replace(PLAYGROUND_URL_RE, PLACEHOLDER);
}

function comparePlaygroundUrls(oldUrl, newUrl) {
  const oldParsed = parsePlaygroundUrl(oldUrl);
  const newParsed = parsePlaygroundUrl(newUrl);
  if (!oldParsed || !newParsed) {
    return oldUrl === newUrl ? null : `unparsable URL changed: ${oldUrl} -> ${newUrl}`;
  }
  if (oldParsed.gist || newParsed.gist) {
    if (oldUrl !== newUrl) {
      return `gist-referencing URL changed (should be untouched): ${oldUrl} -> ${newUrl}`;
    }
    return null;
  }
  if (oldParsed.code == null || newParsed.code == null) {
    return oldUrl === newUrl ? null : `URL changed with no code= param: ${oldUrl} -> ${newUrl}`;
  }
  const oldCode = decodePlaygroundCode(oldParsed.code);
  const newCode = decodePlaygroundCode(newParsed.code);
  if (oldCode !== newCode) {
    return `decoded code differs:\n--- old ---\n${oldCode}\n--- new ---\n${newCode}`;
  }
  if (
    oldParsed.version !== newParsed.version
    || oldParsed.mode !== newParsed.mode
    || oldParsed.edition !== newParsed.edition
  ) {
    return `version/mode/edition differs: ${oldParsed.version}/${oldParsed.mode}/${oldParsed.edition} -> ${newParsed.version}/${newParsed.mode}/${newParsed.edition}`;
  }
  return null;
}

function main() {
  const [, , oldDir, newDir] = process.argv;
  if (!oldDir || !newDir) {
    console.error('Usage: node scripts/verify-build-equivalence.js <old-dir> <new-dir>');
    process.exit(2);
  }

  const oldFiles = new Set(listHtmlFiles(oldDir));
  const newFiles = new Set(listHtmlFiles(newDir));
  const missing = [...oldFiles].filter((f) => !newFiles.has(f));
  const extra = [...newFiles].filter((f) => !oldFiles.has(f));

  const problems = [];
  if (missing.length) problems.push(`missing in new build: ${missing.join(', ')}`);
  if (extra.length) problems.push(`unexpected extra files in new build: ${extra.join(', ')}`);

  let totalUrlsCompared = 0;

  [...oldFiles]
    .filter((f) => newFiles.has(f))
    .forEach((file) => {
      const oldContent = fs.readFileSync(path.join(oldDir, file), 'utf8');
      const newContent = fs.readFileSync(path.join(newDir, file), 'utf8');

      const oldUrls = oldContent.match(PLAYGROUND_URL_RE) || [];
      const newUrls = newContent.match(PLAYGROUND_URL_RE) || [];

      if (normalize(oldContent) !== normalize(newContent)) {
        problems.push(`${file}: non-Playground-URL content differs`);
        return;
      }

      if (oldUrls.length !== newUrls.length) {
        problems.push(`${file}: Playground URL count differs (${oldUrls.length} -> ${newUrls.length})`);
        return;
      }

      oldUrls.forEach((oldUrl, i) => {
        totalUrlsCompared += 1;
        const problem = comparePlaygroundUrls(oldUrl, newUrls[i]);
        if (problem) {
          problems.push(`${file} (playground url #${i}): ${problem}`);
        }
      });
    });

  console.log(
    `Compared ${oldFiles.size} old / ${newFiles.size} new files, ${totalUrlsCompared} playground URLs.`,
  );

  if (problems.length) {
    console.log(`\n${problems.length} problem(s) found:\n`);
    problems.slice(0, 50).forEach((p) => console.log(`- ${p}`));
    if (problems.length > 50) {
      console.log(`... and ${problems.length - 50} more`);
    }
    process.exit(1);
  }

  console.log('OK: builds are equivalent (identical HTML modulo decoded Playground code).');
}

main();
