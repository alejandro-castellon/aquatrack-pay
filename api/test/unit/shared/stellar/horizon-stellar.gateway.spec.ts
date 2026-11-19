import { HorizonStellarGateway } from '@/shared/stellar/horizon-stellar.gateway';
import {
  StellarGatewayError,
  StellarInputError,
} from '@/shared/stellar/stellar-gateway.interface';
import { loadStellarConfig } from '@/shared/stellar/stellar.config';

const HORIZON = 'https://horizon-testnet.stellar.org';
const ACCOUNT = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const OUTER = 'a'.repeat(64);
const INNER = 'b'.repeat(64);

/**
 * Reads only: they go to Horizon with fetch, mocked here. The two writes load
 * the Stellar SDK, which Jest cannot load, so they are covered on testnet by
 * `pnpm demo:smoke`; what is checked here is that they refuse to start
 * without an operations account, before the SDK is touched.
 */
describe('HorizonStellarGateway', () => {
  let fetchMock: jest.Mock;
  let gateway: HorizonStellarGateway;
  const originalFetch = global.fetch;

  const json = (status: number, body: unknown = {}) =>
    Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    } as Response);
  const requested = (call = 0): string => fetchMock.mock.calls[call][0];

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    gateway = new HorizonStellarGateway(loadStellarConfig({}));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getAccount', () => {
    it('reads the account from Horizon', async () => {
      fetchMock.mockReturnValue(json(200, { account_id: ACCOUNT }));

      await expect(gateway.getAccount(ACCOUNT)).resolves.toEqual({
        account_id: ACCOUNT,
      });
      expect(requested()).toBe(`${HORIZON}/accounts/${ACCOUNT}`);
    });

    it('returns null for an account that does not exist', async () => {
      fetchMock.mockReturnValue(json(404));

      await expect(gateway.getAccount(ACCOUNT)).resolves.toBeNull();
    });

    it('does not ask Horizon about something that is not an account id', async () => {
      await expect(gateway.getAccount('../transactions')).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails with StellarGatewayError when Horizon answers an error', async () => {
      fetchMock.mockReturnValue(json(503));

      await expect(gateway.getAccount(ACCOUNT)).rejects.toThrow(
        StellarGatewayError,
      );
    });

    it('fails with StellarGatewayError when Horizon cannot be reached', async () => {
      fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      await expect(gateway.getAccount(ACCOUNT)).rejects.toThrow(
        'Could not reach Horizon: getaddrinfo ENOTFOUND',
      );
    });
  });

  describe('getTransactionOperations', () => {
    it('joins every operation with its transaction', async () => {
      const transaction = { hash: OUTER, ledger: 7, successful: true };
      fetchMock.mockReturnValueOnce(json(200, transaction)).mockReturnValueOnce(
        json(200, {
          _embedded: { records: [{ id: '1', transaction_hash: OUTER }] },
        }),
      );

      await expect(
        gateway.getTransactionOperations(` ${OUTER.toUpperCase()} `),
      ).resolves.toEqual([{ id: '1', transaction_hash: OUTER, transaction }]);
      expect(requested(0)).toBe(`${HORIZON}/transactions/${OUTER}`);
      expect(requested(1)).toBe(
        `${HORIZON}/transactions/${OUTER}/operations?limit=200&order=asc`,
      );
    });

    it('asks for the operations by the hash Horizon reports', async () => {
      // Looked up by the inner hash of a fee bump, Horizon echoes it back.
      fetchMock
        .mockReturnValueOnce(json(200, { hash: INNER }))
        .mockReturnValueOnce(json(200, { _embedded: { records: [] } }));

      await expect(gateway.getTransactionOperations(INNER)).resolves.toEqual(
        [],
      );
      expect(requested(1)).toContain(`/transactions/${INNER}/operations`);
    });

    it('returns null while Horizon does not know the hash', async () => {
      fetchMock.mockReturnValue(json(404));

      await expect(gateway.getTransactionOperations(OUTER)).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns null for a string that is not a hash, without a request', async () => {
      await expect(
        gateway.getTransactionOperations('not-a-hash'),
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('listAccountPayments', () => {
    it('asks for the payments joined with their transactions', async () => {
      fetchMock.mockReturnValue(
        json(200, { _embedded: { records: [{ id: '1' }] } }),
      );

      await expect(
        gateway.listAccountPayments(ACCOUNT, {
          order: 'asc',
          limit: 200,
          cursor: '42',
        }),
      ).resolves.toEqual([{ id: '1' }]);

      const url = new URL(requested());
      expect(url.pathname).toBe(`/accounts/${ACCOUNT}/payments`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        order: 'asc',
        limit: '200',
        join: 'transactions',
        cursor: '42',
      });
    });

    it('starts from the beginning without a cursor and caps the page size', async () => {
      fetchMock.mockReturnValue(json(200, { _embedded: { records: [] } }));

      await gateway.listAccountPayments(ACCOUNT, { order: 'desc', limit: 999 });

      const url = new URL(requested());
      expect(url.searchParams.get('limit')).toBe('200');
      expect(url.searchParams.has('cursor')).toBe(false);
    });

    it('returns nothing for an account that does not exist', async () => {
      fetchMock.mockReturnValue(json(404));

      await expect(
        gateway.listAccountPayments(ACCOUNT, { order: 'asc', limit: 10 }),
      ).resolves.toEqual([]);
    });
  });

  describe('writes', () => {
    it('has no operations account unless one is configured', async () => {
      await expect(gateway.opsPublicKey()).resolves.toBeNull();
    });

    it('refuses to create a treasury without an operations account', async () => {
      await expect(
        gateway.createTreasuryAccount({ signers: [ACCOUNT], threshold: 1 }),
      ).rejects.toThrow(StellarInputError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses to send funds without an operations account', async () => {
      await expect(
        gateway.sendFromOps({ destination: ACCOUNT, amount: '1.0000000' }),
      ).rejects.toThrow(
        'The operations account is not configured (STELLAR_OPS_SECRET)',
      );
    });

    it('never signs on the public network, whatever the environment says', async () => {
      const publicGateway = new HorizonStellarGateway(
        loadStellarConfig({
          STELLAR_NETWORK: 'public',
          STELLAR_OPS_SECRET: 'SOMESECRET',
        }),
      );

      await expect(
        publicGateway.createTreasuryAccount({
          signers: [ACCOUNT],
          threshold: 1,
        }),
      ).rejects.toThrow('The server only signs on testnet');
      await expect(publicGateway.opsPublicKey()).resolves.toBeNull();
    });
  });
});
