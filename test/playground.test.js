// eslint-disable-next-line import/no-unresolved -- node: builtin, needs the prefix
const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {
  buildPlaygroundUrl,
  parsePlaygroundUrl,
  decodePlaygroundCode,
} = require('../scripts/lib/playground');

function walkChapterFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkChapterFiles(p);
    if (entry.isFile() && entry.name.startsWith('chapter_') && entry.name.endsWith('.yaml')) {
      return [p];
    }
    return [];
  });
}

test('buildPlaygroundUrl round-trips arbitrary Rust source', () => {
  const samples = [
    'fn main() {\n    println!("hello \\"world\\"");\n}\n',
    "fn main() {\n    // it's a comment with an apostrophe\n}\n",
    'fn main() {\n    println!("こんにちは、Rust!");\n}',
    'fn main() {}',
  ];
  samples.forEach((code) => {
    const url = buildPlaygroundUrl(code);
    const parsed = parsePlaygroundUrl(url);
    assert.ok(parsed, `expected ${url} to parse as a Playground URL`);
    assert.equal(decodePlaygroundCode(parsed.code), code);
  });
});

test('buildPlaygroundUrl defaults to edition 2018 and honors overrides', () => {
  const defaultUrl = buildPlaygroundUrl('fn main() {}');
  assert.equal(parsePlaygroundUrl(defaultUrl).edition, '2018');

  const overriddenUrl = buildPlaygroundUrl('fn main() {}', { edition: 2021 });
  assert.equal(parsePlaygroundUrl(overriddenUrl).edition, '2021');
});

test('every raw-source `code:` field in lessons/**/chapter_*.yaml survives the encode/decode round trip generate.js relies on', () => {
  const lessonsRoot = path.join(__dirname, '..', 'lessons');
  const files = walkChapterFiles(lessonsRoot);
  let checked = 0;

  files.forEach((file) => {
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(doc)) return;
    // Entries that are already a full URL (external gist references,
    // WebAssembly Studio embeds, ...) are passed through by generate.js
    // untouched and are out of scope here.
    doc
      .filter((entry) => entry && typeof entry.code === 'string' && !/^https?:\/\//.test(entry.code))
      .forEach((entry) => {
        const url = buildPlaygroundUrl(entry.code, { edition: entry.edition });
        const parsed = parsePlaygroundUrl(url);
        assert.ok(parsed && parsed.code != null, `${file}: failed to build a Playground URL`);
        assert.equal(
          decodePlaygroundCode(parsed.code),
          entry.code,
          `${file}: code did not survive the Playground URL round trip`,
        );
        checked += 1;
      });
  });

  // Sanity check that this test actually exercised the migrated corpus
  // instead of silently matching zero entries (e.g. due to a path typo).
  assert.ok(checked >= 1500, `expected to check at least 1500 entries, only checked ${checked}`);
});
