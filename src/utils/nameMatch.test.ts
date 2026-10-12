import { describe, it, expect } from 'vitest';
import { nameIncludes, normalizeName } from './nameMatch';

describe('nameMatch (#274)', () => {
  it('folds mathematical italic letters to plain ones', () => {
    expect(normalizeName('𝘞𝘶𝘭𝘧𝘧𝘻𝘪𝘦')).toBe('wulffzie');
  });

  it('folds script, bold, fullwidth and circled letters', () => {
    expect(normalizeName('𝓖𝓪𝓶𝓲𝓷𝓰')).toBe('gaming');
    expect(normalizeName('𝐃𝐞𝐯')).toBe('dev');
    expect(normalizeName('Ｌｏｕｎｇｅ')).toBe('lounge');
    expect(normalizeName('Ⓒⓛⓤⓑ')).toBe('club');
  });

  it('matches a plain query against a fancy name and the other way round', () => {
    expect(nameIncludes('𝘛𝘩𝘦 𝘎𝘢𝘮𝘪𝘯𝘨 𝘓𝘰𝘶𝘯𝘨𝘦', 'gaming')).toBe(true);
    expect(nameIncludes('The Gaming Lounge', '𝘎𝘢𝘮𝘪𝘯𝘨')).toBe(true);
  });

  it('stays case insensitive and trims the query', () => {
    expect(nameIncludes('Beta Server', '  BETA ')).toBe(true);
    expect(nameIncludes('Beta Server', 'gamma')).toBe(false);
  });

  it('treats a missing name as empty', () => {
    expect(nameIncludes(undefined, 'x')).toBe(false);
    expect(nameIncludes(null, '')).toBe(true);
  });
});
