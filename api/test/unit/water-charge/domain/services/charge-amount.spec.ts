import { convertBsToUsdc } from '@/modules/water-charge/domain/services/charge-amount';
import { toStroops } from '@/shared/stellar/stellar-amount';

describe('convertBsToUsdc', () => {
  it.each([
    // amount in Bs, Bs per USDC, USDC rounded up to the cent
    [155, 6.96, '22.2800000'],
    [111.6, 6.96, '16.0400000'],
    [0.01, 6.96, '0.0100000'],
    [124, 11.84, '10.4800000'],
    [1240, 11.84, '104.7300000'],
  ])('converts Bs %s at %s to %s USDC', (amountBs, rate, expected) => {
    expect(convertBsToUsdc(amountBs, rate).amountUsdc).toBe(expected);
  });

  it('does not round up when the division is exact', () => {
    expect(convertBsToUsdc(69.6, 6.96)).toEqual({
      amountUsdc: '10.0000000',
      stroops: 100_000_000n,
    });
  });

  it('returns stroops that match the formatted amount', () => {
    const result = convertBsToUsdc(155, 6.96);

    expect(result.stroops).toBe(222_800_000n);
    expect(toStroops(result.amountUsdc)).toBe(result.stroops);
  });

  it('accepts decimal strings without going through floats', () => {
    expect(convertBsToUsdc('155.00', '6.9600').amountUsdc).toBe('22.2800000');
    expect(convertBsToUsdc(' 111.6 ', '6.96').amountUsdc).toBe('16.0400000');
  });

  it('never quotes less than what covers the charge', () => {
    // 100 / 3 = 33.333...: 33.33 would leave the charge short.
    const { amountUsdc } = convertBsToUsdc(100, 3);

    expect(amountUsdc).toBe('33.3400000');
    expect(Number(amountUsdc) * 3).toBeGreaterThanOrEqual(100);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, '', 'abc', '12.345'])(
    'rejects the amount %p',
    (amountBs) => {
      expect(() => convertBsToUsdc(amountBs, 6.96)).toThrow(RangeError);
    },
  );

  it.each([0, -1, Number.NaN, '', '6.96001'])(
    'rejects the exchange rate %p',
    (rate) => {
      expect(() => convertBsToUsdc(155, rate)).toThrow(RangeError);
    },
  );
});
