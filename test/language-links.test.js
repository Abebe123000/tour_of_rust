// eslint-disable-next-line import/no-unresolved -- node: builtin, needs the prefix
const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
  LANGUAGE_NAMES,
  LANGUAGE_LINKS_PLACEHOLDER,
  buildLanguageLinksHtml,
} = require('../scripts/lib/language-links');

const lessonsDir = path.join(__dirname, '..', 'lessons');
const languages = fs
  .readdirSync(lessonsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

test('every lessons/ language directory has a display name', () => {
  languages.forEach((lang) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, lang),
      `LANGUAGE_NAMES is missing an entry for "${lang}" (scripts/lib/language-links.js)`,
    );
  });
});

test('buildLanguageLinksHtml links every other language and excludes the current one', () => {
  const getFileName = (lang, i) => (i === 0 && lang === 'en' ? 'index.html' : `00_${lang}.html`);

  languages.forEach((lang) => {
    const html = buildLanguageLinksHtml(languages, lang, getFileName);
    assert.ok(!html.includes(`href="${getFileName(lang, 0)}"`), `${lang} should not link to its own page`);

    languages
      .filter((other) => other !== lang)
      .forEach((other) => {
        assert.ok(
          html.includes(`href="${getFileName(other, 0)}"`),
          `${lang}'s language link list is missing a link to ${other}`,
        );
      });
  });
});

test('every lessons/*/chapter_0.yaml embeds the language links placeholder', () => {
  languages.forEach((lang) => {
    const file = path.join(lessonsDir, lang, 'chapter_0.yaml');
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(
      content.includes(LANGUAGE_LINKS_PLACEHOLDER),
      `${file} should embed ${LANGUAGE_LINKS_PLACEHOLDER} instead of a hand-written language list`,
    );
  });
});
