/**
 * A flat key → string lookup with a language toggle.
 *
 * Chinese is the default. `detectLanguage` honours a stored preference first,
 * then the browser's own languages, then falls back to Chinese.
 */

import zh from './locales/zh.js';
import en from './locales/en.js';

const TABLES = { zh, en };
export const LANGUAGES = Object.freeze(['zh', 'en']);

export function detectLanguage(stored) {
  if (LANGUAGES.includes(stored)) return stored;
  const candidates = typeof navigator === 'undefined'
    ? []
    : [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    if (candidate.toLowerCase().startsWith('zh')) return 'zh';
    if (candidate.toLowerCase().startsWith('en')) return 'en';
  }
  return 'zh';
}

export class I18n {
  constructor(language = 'zh') {
    this.language = LANGUAGES.includes(language) ? language : 'zh';
  }

  setLanguage(language) {
    this.language = LANGUAGES.includes(language) ? language : 'zh';
  }

  /** The other language, for the toggle's label. */
  get otherLanguage() {
    return this.language === 'zh' ? 'en' : 'zh';
  }

  t(key, params) {
    const table = TABLES[this.language] ?? TABLES.zh;
    let text = table[key];
    if (text == null) text = TABLES.zh[key];
    if (text == null) return key;
    if (params != null) {
      for (const [name, value] of Object.entries(params)) {
        // The replacement is a *function*, not a string. `String.prototype.
        // replaceAll` interprets `$&`, `$$`, `` $` `` and `$'` in a string
        // replacement, and one of the values substituted here is a holiday name
        // quoted from a third-party document — so `$&` in a name would come out
        // as the literal placeholder rather than as itself.
        text = text.replaceAll(`{${name}}`, () => String(value));
      }
    }
    return text;
  }
}
