import { describe, it, expect } from 'vitest';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

function getKeys(obj, prefix = '') {
  let keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys = keys.concat(getKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe('i18n Key Parity', () => {
  it('fr.json contains every key defined in en.json', () => {
    const enKeys = getKeys(en);
    const frKeysSet = new Set(getKeys(fr));

    const missing = enKeys.filter((k) => !frKeysSet.has(k));
    expect(missing).toEqual([]);
  });
});
