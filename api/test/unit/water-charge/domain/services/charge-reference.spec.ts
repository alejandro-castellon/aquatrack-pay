import {
  CHARGE_MEMO_PATTERN,
  PUBLIC_CODE_PATTERN,
  generateChargeMemo,
  generatePublicCode,
  normalizeChargeMemo,
} from '@/modules/water-charge/domain/services/charge-reference';

describe('charge-reference', () => {
  describe('generateChargeMemo', () => {
    it('builds "AQT-" plus 10 Crockford characters', () => {
      const memo = generateChargeMemo();

      expect(memo).toMatch(CHARGE_MEMO_PATTERN);
      expect(memo).toHaveLength(14);
    });

    it('fits in a Stellar text memo (28 bytes)', () => {
      expect(Buffer.byteLength(generateChargeMemo(), 'utf8')).toBeLessThan(28);
    });

    it('never uses the letters Crockford leaves out', () => {
      for (let i = 0; i < 500; i++) {
        expect(generateChargeMemo().slice(4)).not.toMatch(/[ILOU]/);
      }
    });

    it('does not repeat', () => {
      const memos = new Set(
        Array.from({ length: 2000 }, () => generateChargeMemo()),
      );

      expect(memos.size).toBe(2000);
    });
  });

  describe('generatePublicCode', () => {
    it('builds 20 lowercase characters unrelated to the memo', () => {
      const code = generatePublicCode();

      expect(code).toMatch(PUBLIC_CODE_PATTERN);
      expect(code).not.toContain('aqt-');
    });

    it('does not repeat', () => {
      const codes = new Set(
        Array.from({ length: 2000 }, () => generatePublicCode()),
      );

      expect(codes.size).toBe(2000);
    });
  });

  describe('normalizeChargeMemo', () => {
    it('keeps a canonical memo as it is', () => {
      expect(normalizeChargeMemo('AQT-7F3K2M9QXZ')).toBe('AQT-7F3K2M9QXZ');
    });

    it('accepts a memo typed by hand: spaces, lower case and look-alikes', () => {
      expect(normalizeChargeMemo('  aqt-7f3k2m9qxz ')).toBe('AQT-7F3K2M9QXZ');
      expect(normalizeChargeMemo('AQT-O0IL1ABCDE')).toBe('AQT-00111ABCDE');
    });

    it.each([
      null,
      undefined,
      '',
      'hola',
      'AQT-',
      'AQT-123',
      'AQT-7F3K2M9QXZ1',
      'AQT-7F3K2M9QX!',
      'XYZ-7F3K2M9QXZ',
      'AQT-7F3K2M9QXU',
    ])('returns null for %p', (memo) => {
      expect(normalizeChargeMemo(memo)).toBeNull();
    });
  });
});
