/**
 * Native display name for each language directory under `lessons/`.
 * This is the one place that needs a manual entry when a new language is
 * added; the list of *which* languages link to each other is derived from
 * the directory listing itself (see generate.js), not maintained by hand.
 * @type {Record<string, string>}
 */
const LANGUAGE_NAMES = {
  al: 'Shqip',
  ar: 'العربية',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fa: 'فارسی',
  fi: 'Suomi',
  fr: 'Français',
  gr: 'Ελληνικά',
  hu: 'Magyar',
  id: 'Bahasa Indonesia',
  ie: 'Interlingue',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  nl: 'Nederlands',
  pl: 'Polski',
  'pt-br': 'Português Brasileiro',
  ro: 'Română',
  ru: 'Русский',
  th: 'ภาษาไทย',
  tr: 'Türkçe',
  ua: 'Українська',
  vi: 'Tiếng Việt',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
};

/** Marker that chapter_0.yaml files embed in place of a hand-written link list. */
const LANGUAGE_LINKS_PLACEHOLDER = '<!--TOUR_LANGUAGE_LINKS-->';

/**
 * @param {string} code language directory name
 * @returns {string}
 */
function getLanguageDisplayName(code) {
  return LANGUAGE_NAMES[code] || code;
}

/**
 * Builds the "also available in" link list for `currentLang`, linking to
 * every other known language's first page.
 * @param {string[]} languages every language directory name (from getDirectories)
 * @param {string} currentLang
 * @param {(lang: string, i: number) => string} getFileName resolves a language's first page URL
 * @returns {string} an `<ul>` of `<li><a>` entries
 */
function buildLanguageLinksHtml(languages, currentLang, getFileName) {
  const items = languages
    .filter((code) => code !== currentLang)
    .slice()
    .sort()
    .map((code) => `<li><a href="${getFileName(code, 0)}">${getLanguageDisplayName(code)}</a></li>`)
    .join('');
  return `<ul>${items}</ul>`;
}

module.exports = {
  LANGUAGE_NAMES,
  LANGUAGE_LINKS_PLACEHOLDER,
  getLanguageDisplayName,
  buildLanguageLinksHtml,
};
