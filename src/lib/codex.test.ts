import { describe, expect, it } from 'vitest';
import {
  getSequenceLabel,
  isValidCitizenInitials,
  normalizeCitizenInitials,
  parseCodexEntry,
  serializeCodexEntry,
} from './codex';

describe('Citizen signature', () => {
  it('normalizes to two uppercase letters', () => {
    expect(normalizeCitizenInitials('o1z-ma')).toBe('OZ');
    expect(normalizeCitizenInitials('')).toBe('');
  });

  it('accepts exactly two letters only', () => {
    expect(isValidCitizenInitials('OC')).toBe(true);
    expect(isValidCitizenInitials('O')).toBe(false);
    expect(isValidCitizenInitials('OCC')).toBe(false);
    expect(isValidCitizenInitials('o1')).toBe(false);
  });
});

describe('entry format', () => {
  const draft = {
    title: 'First Parameter',
    sequence: 'B' as const,
    signature: 'oc',
    catalyst: 'An unmapped event\nwith two lines',
    friction: 'A gap',
    parameter: 'A rule',
    notes: 'Later thoughts',
  };

  it('round-trips through serialize and parse', () => {
    const parsed = parseCodexEntry(serializeCodexEntry(draft));
    expect(parsed).toMatchObject({
      title: 'First Parameter',
      sequence: 'B',
      sequenceLabel: getSequenceLabel('B'),
      signature: 'OC',
      catalyst: 'An unmapped event\nwith two lines',
      friction: 'A gap',
      parameter: 'A rule',
      notes: 'Later thoughts',
    });
  });

  it('omits notes when empty and defaults to Sequence A', () => {
    const parsed = parseCodexEntry(serializeCodexEntry({ ...draft, sequence: undefined, notes: '' }));
    expect(parsed.notes).toBeUndefined();
    expect(parsed.sequence).toBe('A');
  });

  it('fills placeholders for missing sections instead of failing', () => {
    const parsed = parseCodexEntry('TITLE: Partial');
    expect(parsed).toMatchObject({ title: 'Partial', catalyst: '—', friction: '—', parameter: '—', signature: null });
  });

  it('does not treat entry text that looks like a section header as extra content', () => {
    const parsed = parseCodexEntry(serializeCodexEntry({ ...draft, catalyst: 'plain text' }));
    expect(parsed.protocol).toBe('PROTOCOL 03: ITERATIVE FORMULA');
  });
});
