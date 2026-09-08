const PLAYGROUND_ORIGIN = 'https://play.rust-lang.org/?';
const DEFAULT_VERSION = 'stable';
const DEFAULT_MODE = 'debug';
const DEFAULT_EDITION = 2018;

/**
 * Parses a Rust Playground URL of the form produced by play.rust-lang.org's
 * "share" feature. Returns null when `value` isn't such a URL.
 * @param {string} value
 * @returns {{
 *   version: string, mode: string, edition: string, code: string|null, gist: string|null
 * } | null}
 */
function parsePlaygroundUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(PLAYGROUND_ORIGIN)) {
    return null;
  }
  const qs = value.slice(PLAYGROUND_ORIGIN.length);
  const version = (qs.match(/(?:^|&)version=([^&]*)/) || [])[1] || null;
  const mode = (qs.match(/(?:^|&)mode=([^&]*)/) || [])[1] || null;
  const edition = (qs.match(/(?:^|&)edition=([^&]*)/) || [])[1] || null;
  const gistMatch = qs.match(/(?:^|&)gist=([^&]*)/);
  const codeMatch = qs.match(/(?:^|&)code=([\s\S]*)$/);
  return {
    version,
    mode,
    edition,
    gist: gistMatch ? gistMatch[1] : null,
    code: codeMatch ? codeMatch[1] : null,
  };
}

/**
 * Decodes the percent-encoded `code=` query value of a Playground URL back
 * into the original Rust source.
 * @param {string} encodedCode
 * @returns {string}
 */
function decodePlaygroundCode(encodedCode) {
  return decodeURIComponent(encodedCode);
}

/**
 * Builds a Rust Playground URL that embeds the given raw source code,
 * matching the query param layout/order used by play.rust-lang.org's share
 * links (version, mode, edition, code).
 * @param {string} code raw Rust source
 * @param {{edition?: number|string}} [options]
 * @returns {string}
 */
function buildPlaygroundUrl(code, options) {
  const edition = (options && options.edition) || DEFAULT_EDITION;
  const encoded = encodeURIComponent(code);
  return `${PLAYGROUND_ORIGIN}version=${DEFAULT_VERSION}&mode=${DEFAULT_MODE}&edition=${edition}&code=${encoded}`;
}

module.exports = {
  PLAYGROUND_ORIGIN,
  DEFAULT_VERSION,
  DEFAULT_MODE,
  DEFAULT_EDITION,
  parsePlaygroundUrl,
  decodePlaygroundCode,
  buildPlaygroundUrl,
};
