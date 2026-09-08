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
 * A URL pair that changes from a `gist=<id>` reference to an inline `code=`
 * source (the migration in issue #13) is a special case of (3): since the
 * gist URL carries no source itself, it's checked by fetching the id's code
 * from Playground's public gist API and comparing that against the new
 * inline source, instead of comparing the two URLs directly.
 *
 * Usage: node scripts/verify-build-equivalence.js <old-dir> <new-dir>
 */
const fs = require('fs');
const path = require('path');
const { parsePlaygroundUrl, decodePlaygroundCode } = require('./lib/playground');

const PLAYGROUND_URL_RE = /https:\/\/play\.rust-lang\.org\/\?[^"]*/g;
const PLACEHOLDER = '__PLAYGROUND_URL__';
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

async function comparePlaygroundUrls(oldUrl, newUrl) {
  const oldParsed = parsePlaygroundUrl(oldUrl);
  const newParsed = parsePlaygroundUrl(newUrl);
  if (!oldParsed || !newParsed) {
    return oldUrl === newUrl ? null : `unparsable URL changed: ${oldUrl} -> ${newUrl}`;
  }
  if (oldParsed.gist && !newParsed.gist && newParsed.code != null) {
    // Migrated from a gist= reference to an inline code= source (#13): the
    // URL is expected to change, so verify against the gist's actual
    // content instead of comparing the two URLs.
    const gistCode = await fetchGistCode(oldParsed.gist);
    const newCode = decodePlaygroundCode(newParsed.code);
    if (gistCode !== newCode) {
      return `gist ${oldParsed.gist} migrated to different code:\n--- gist ---\n${gistCode}\n--- new ---\n${newCode}`;
    }
    return null;
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

async function main() {
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

  const sharedFiles = [...oldFiles].filter((f) => newFiles.has(f));
  // eslint-disable-next-line no-restricted-syntax
  for (const file of sharedFiles) {
    const oldContent = fs.readFileSync(path.join(oldDir, file), 'utf8');
    const newContent = fs.readFileSync(path.join(newDir, file), 'utf8');

    const oldUrls = oldContent.match(PLAYGROUND_URL_RE) || [];
    const newUrls = newContent.match(PLAYGROUND_URL_RE) || [];

    if (normalize(oldContent) !== normalize(newContent)) {
      problems.push(`${file}: non-Playground-URL content differs`);
      // eslint-disable-next-line no-continue
      continue;
    }

    if (oldUrls.length !== newUrls.length) {
      problems.push(`${file}: Playground URL count differs (${oldUrls.length} -> ${newUrls.length})`);
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const urlProblems = await Promise.all(
      oldUrls.map((oldUrl, i) => comparePlaygroundUrls(oldUrl, newUrls[i])),
    );
    totalUrlsCompared += oldUrls.length;
    urlProblems.forEach((problem, i) => {
      if (problem) {
        problems.push(`${file} (playground url #${i}): ${problem}`);
      }
    });
  }

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
