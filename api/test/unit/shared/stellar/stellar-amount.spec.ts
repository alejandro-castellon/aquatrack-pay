import { fromStroops, toStroops } from '@/shared/stellar/stellar-amount';

describe('stellar-amount', () => {
  describe('toStroops', () => {
    it.each([
      ['0', 0n],
      ['1', 10_000_000n],
      ['22.28', 222_800_000n],
      ['22.2800000', 222_800_000n],
      ['0.0000001', 1n],
      ['922337203685.4775807', 9_223_372_036_854_775_807n],
    ])('parses %s', (amount, expected) => {
      expect(toStroops(amount)).toBe(expected);
    });

    it.each(['', '-1', '1.', '.5', '1.00000001', '1,5', 'abc', '1e3', ' 1'])(
      'rejects %p',
      (amount) => {
        expect(() => toStroops(amount)).toThrow('Invalid Stellar amount');
      },
    );

    it('rejects a number, so no float ever becomes an amount', () => {
      expect(() => toStroops(22.28 as unknown as string)).toThrow(
        'Invalid Stellar amount',
      );
    });
  });

  describe('fromStroops', () => {
    it.each([
      [0n, '0.0000000'],
      [1n, '0.0000001'],
      [222_800_000n, '22.2800000'],
      [10_000_000n, '1.0000000'],
    ])('formats %s', (stroops, expected) => {
      expect(fromStroops(stroops)).toBe(expected);
    });

    it('round-trips with toStroops', () => {
      for (const amount of ['0.0100000', '16.0400000', '104.7300000']) {
        expect(fromStroops(toStroops(amount))).toBe(amount);
      }
    });

    it('rejects negative amounts', () => {
      expect(() => fromStroops(-1n)).toThrow('cannot be negative');
    });
  });
});
