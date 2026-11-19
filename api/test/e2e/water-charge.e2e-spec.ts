import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '@/shared/database/prisma.service';
import { ReconcileTreasuryTransfersUseCase } from '@/modules/water-charge/application/use-cases/reconcile-treasury-transfers';
import { createTestApp } from '@test/utils/test-app';
import { resetDatabase } from '@test/utils/db';
import {
  createAccessTokenForUser,
  createAdminWithBuilding,
  createAuthToken,
} from '@test/utils/auth';
import { createApartment, createUser } from '@test/utils/factories';
import {
  FAKE_ASSET_ISSUER,
  FakeStellarGateway,
  fakeAccountId,
  fakeTxHash,
} from '@test/utils/fake-stellar-gateway';

const MONTH = '2026-10';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface ChargeBody {
  id: string;
  apartmentId: string;
  apartmentNumber: string;
  amountBs: number;
  amountUsdc: string;
  status: string;
  memo: string;
  publicCode: string;
  txHash: string | null;
}

/**
 * Water charges and the building treasury against a real database. Stellar is
 * the in-memory gateway createTestApp installs: payments are registered on it
 * by hand, exactly what Horizon would report.
 */
describe('Water charges (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stellar: FakeStellarGateway;

  beforeAll(async () => {
    const context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
    stellar = context.stellar;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    stellar.reset();
  });

  const signers = () => [
    { publicKey: fakeAccountId(), label: 'Administrador' },
    { publicKey: fakeAccountId(), label: 'Presidenta de la directiva' },
    { publicKey: fakeAccountId(), label: 'Tesorero' },
  ];

  /** An admin with a building, two apartments and their saved October. */
  async function buildingWithSavedMonth() {
    const { admin, building, accessToken } = await createAdminWithBuilding(
      app,
      prisma,
    );
    const owner = await createUser(prisma, { role: 'owner' });
    const first = await createApartment(prisma, {
      buildingId: building.id,
      apartmentNumber: '101',
      floor: 1,
      ownerId: owner.id,
    });
    const second = await createApartment(prisma, {
      buildingId: building.id,
      apartmentNumber: '201',
      floor: 2,
    });

    for (const [apartment, payment] of [
      [first, 155],
      [second, 111.6],
    ] as const) {
      await prisma.apartmentMonthlyConsumption.create({
        data: {
          apartmentId: apartment.id,
          month: MONTH,
          consumption: payment / 13.5,
          payment,
          avgDailyUsage: 0.3,
          peakDayUsage: 0.6,
          periodStartDate: new Date('2026-10-01T00:00:00.000Z'),
          periodEndDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });
    }

    return {
      admin,
      building,
      accessToken,
      owner,
      ownerToken: createAccessTokenForUser(app, owner),
      first,
      second,
    };
  }

  async function createTreasury(buildingId: string, accessToken: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/buildings/${buildingId}/treasury`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ signers: signers(), threshold: 2 })
      .expect(201);
    return response.body.treasury as { publicKey: string };
  }

  async function publish(
    buildingId: string,
    accessToken: string,
  ): Promise<{ created: number; charges: ChargeBody[] }> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/water-charges/publish')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ buildingId, month: MONTH, bsPerUsdc: 6.96 })
      .expect(201);
    return response.body;
  }

  it('creates one treasury per building, controlled only by its signers', async () => {
    const { building, accessToken } = await createAdminWithBuilding(
      app,
      prisma,
    );
    const url = `/api/v1/buildings/${building.id}/treasury`;

    const empty = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(empty.body).toEqual({ treasury: null });

    const treasury = await createTreasury(building.id, accessToken);

    const found = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(found.body.treasury).toEqual(
      expect.objectContaining({
        publicKey: treasury.publicKey,
        network: 'testnet',
        assetCode: 'USDC',
        assetIssuer: FAKE_ASSET_ISSUER,
        threshold: 2,
        transfers: [],
      }),
    );
    expect(found.body.treasury.onChain).toEqual(
      expect.objectContaining({
        masterWeight: 0,
        thresholds: { low: 2, med: 2, high: 2 },
      }),
    );
    expect(found.body.treasury.onChain.signers).toHaveLength(3);

    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ signers: signers(), threshold: 2 })
      .expect(409);
    await expect(
      prisma.buildingTreasury.count({ where: { buildingId: building.id } }),
    ).resolves.toBe(1);
  });

  it('publishes a saved month once: publishing again changes nothing', async () => {
    const { building, accessToken, first, second } =
      await buildingWithSavedMonth();

    // No treasury yet.
    await request(app.getHttpServer())
      .post('/api/v1/water-charges/publish')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ buildingId: building.id, month: MONTH, bsPerUsdc: 6.96 })
      .expect(409);

    await createTreasury(building.id, accessToken);
    const published = await publish(building.id, accessToken);

    expect(published.created).toBe(2);
    expect(published.charges).toEqual([
      expect.objectContaining({
        apartmentId: first.id,
        apartmentNumber: '101',
        amountBs: 155,
        amountUsdc: '22.2800000',
        status: 'pending',
        txHash: null,
      }),
      expect.objectContaining({
        apartmentId: second.id,
        apartmentNumber: '201',
        amountBs: 111.6,
        amountUsdc: '16.0400000',
      }),
    ]);

    const again = await publish(building.id, accessToken);

    expect(again.created).toBe(0);
    expect(
      again.charges.map(({ id, memo, publicCode }) => ({
        id,
        memo,
        publicCode,
      })),
    ).toEqual(
      published.charges.map(({ id, memo, publicCode }) => ({
        id,
        memo,
        publicCode,
      })),
    );
    await expect(
      prisma.waterCharge.count({ where: { buildingId: building.id } }),
    ).resolves.toBe(2);

    await request(app.getHttpServer())
      .post('/api/v1/water-charges/publish')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ buildingId: building.id, month: '2026-01', bsPerUsdc: 6.96 })
      .expect(404);
  });

  it("forbids another building's admin and residents of other apartments", async () => {
    const { building, accessToken, first, second, ownerToken } =
      await buildingWithSavedMonth();
    await createTreasury(building.id, accessToken);
    await publish(building.id, accessToken);
    const outsider = await createAuthToken(app, prisma, 'admin');
    const stranger = await createAuthToken(app, prisma, 'tenant');

    await request(app.getHttpServer())
      .get(`/api/v1/buildings/${building.id}/treasury`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/water-charges/publish')
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ buildingId: building.id, month: MONTH, bsPerUsdc: 6.96 })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/water-charges/by-building/${building.id}`)
      .query({ month: MONTH })
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/water-charges/by-apartment/${first.id}`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403);

    // A resident never reaches the admin routes...
    await request(app.getHttpServer())
      .get(`/api/v1/water-charges/by-building/${building.id}`)
      .query({ month: MONTH })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(403);
    // ...and only sees the apartment that is theirs.
    const mine = await request(app.getHttpServer())
      .get(`/api/v1/water-charges/by-apartment/${first.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].apartmentNumber).toBe('101');

    await request(app.getHttpServer())
      .get(`/api/v1/water-charges/by-apartment/${second.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/water-charges/by-apartment/${first.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(403);

    // No token at all.
    await request(app.getHttpServer())
      .get(`/api/v1/water-charges/by-apartment/${first.id}`)
      .expect(401);
  });

  it('shows the pay link to anyone holding it, without any identifier', async () => {
    const { building, accessToken } = await buildingWithSavedMonth();
    const treasury = await createTreasury(building.id, accessToken);
    const { charges } = await publish(building.id, accessToken);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/water-charges/public/${charges[0].publicCode}`)
      .expect(200);

    expect(response.body).toEqual({
      buildingName: building.name,
      apartmentNumber: '101',
      month: MONTH,
      periodStartDate: '2026-10-01',
      periodEndDate: '2026-10-31',
      consumption: expect.any(Number),
      amountBs: 155,
      exchangeRate: 6.96,
      amountUsdc: '22.2800000',
      status: 'pending',
      payment: {
        destination: treasury.publicKey,
        assetCode: 'USDC',
        assetIssuer: FAKE_ASSET_ISSUER,
        memo: charges[0].memo,
        network: 'testnet',
        networkPassphrase: 'Test SDF Network ; September 2015',
      },
      paid: null,
      demo: { faucetEnabled: true },
    });
    expect(JSON.stringify(response.body)).not.toMatch(UUID);

    // The memo is public on the ledger: it does not open the page.
    await request(app.getHttpServer())
      .get(`/api/v1/water-charges/public/${charges[0].memo}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/water-charges/public/0000000000000000000a')
      .expect(404);
  });

  it('settles a charge on confirmation and answers the same the second time', async () => {
    const { building, accessToken } = await buildingWithSavedMonth();
    const treasury = await createTreasury(building.id, accessToken);
    const { charges } = await publish(building.id, accessToken);
    const [charge] = charges;
    const payer = stellar.addAccount({ balance: '50.0000000' });
    const confirmUrl = `/api/v1/water-charges/public/${charge.publicCode}/confirm`;

    // Not on the network yet.
    const early = await request(app.getHttpServer())
      .post(confirmUrl)
      .send({ txHash: fakeTxHash() })
      .expect(200);
    expect(early.body.outcome).toBe('not_found_yet');

    // One stroop short does not settle.
    const short = stellar.registerPayment({
      from: payer,
      to: treasury.publicKey,
      amounts: ['22.2799999'],
      memo: charge.memo,
    });
    const underpaid = await request(app.getHttpServer())
      .post(confirmUrl)
      .send({ txHash: short.txHash })
      .expect(200);
    expect(underpaid.body.outcome).toBe('underpaid');

    // The payment of another charge does not settle this one.
    const other = stellar.registerPayment({
      from: payer,
      to: treasury.publicKey,
      amounts: ['22.2800000'],
      memo: charges[1].memo,
    });
    const wrongMemo = await request(app.getHttpServer())
      .post(confirmUrl)
      .send({ txHash: other.txHash })
      .expect(200);
    expect(wrongMemo.body.outcome).toBe('wrong_memo');

    // A sponsored payment, confirmed with the hash the wallet reports.
    const payment = stellar.registerPayment({
      from: payer,
      to: treasury.publicKey,
      amounts: ['22.2800000'],
      memo: charge.memo,
      feeBump: true,
    });
    const paid = await request(app.getHttpServer())
      .post(confirmUrl)
      .send({ txHash: payment.innerHash })
      .expect(200);

    expect(paid.body.outcome).toBe('paid');
    expect(paid.body.charge.status).toBe('paid');
    expect(paid.body.charge.paid).toEqual(
      expect.objectContaining({
        txHash: payment.txHash,
        paidAmountUsdc: '22.2800000',
        payerAddress: payer,
      }),
    );

    const again = await request(app.getHttpServer())
      .post(confirmUrl)
      .send({ txHash: payment.txHash })
      .expect(200);
    expect(again.body.outcome).toBe('already_paid');
    expect(again.body.charge.paid.txHash).toBe(payment.txHash);

    const stored = await prisma.waterCharge.findUniqueOrThrow({
      where: { id: charge.id },
    });
    expect(stored.status).toBe('paid');
    expect(stored.txHash).toBe(payment.txHash);
    expect(stored.payerAddress).toBe(payer);
    expect(stored.paidAmountUsdc?.toFixed(7)).toBe('22.2800000');
    expect(stored.paidAt).toBeInstanceOf(Date);

    await request(app.getHttpServer())
      .post(confirmUrl)
      .send({ txHash: 'not-a-hash' })
      .expect(400);
  });

  it('settles on a watcher pass what was paid from another wallet', async () => {
    const { building, accessToken } = await buildingWithSavedMonth();
    const treasury = await createTreasury(building.id, accessToken);
    const { charges } = await publish(building.id, accessToken);
    const payer = stellar.addAccount({ balance: '50.0000000' });
    const reconcile = app.get(ReconcileTreasuryTransfersUseCase);

    await expect(reconcile.execute()).resolves.toEqual({
      treasuries: 1,
      settled: 0,
    });

    const payment = stellar.registerPayment({
      from: payer,
      to: treasury.publicKey,
      amounts: ['16.0400000'],
      memo: charges[1].memo,
    });

    await expect(reconcile.execute()).resolves.toEqual({
      treasuries: 1,
      settled: 1,
    });

    const list = await request(app.getHttpServer())
      .get(`/api/v1/water-charges/by-building/${building.id}`)
      .query({ month: MONTH })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(
      (list.body as ChargeBody[]).map(({ status, txHash }) => [status, txHash]),
    ).toEqual([
      ['pending', null],
      ['paid', payment.txHash],
    ]);

    // The cursor moved: the next pass reads nothing twice.
    const saved = await prisma.buildingTreasury.findUniqueOrThrow({
      where: { buildingId: building.id },
    });
    expect(saved.lastCursor).not.toBeNull();
    await expect(reconcile.execute()).resolves.toEqual({
      treasuries: 1,
      settled: 0,
    });

    // The treasury shows the transfer with its apartment.
    const view = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${building.id}/treasury`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(view.body.treasury.onChain.balance).toBe('16.0400000');
    expect(view.body.treasury.transfers).toEqual([
      expect.objectContaining({
        txHash: payment.txHash,
        status: 'matched',
        apartmentNumber: '201',
        month: MONTH,
        amountUsdc: '16.0400000',
      }),
    ]);
  });

  it('hands out test funds for a pending charge, never more than it needs', async () => {
    const { building, accessToken } = await buildingWithSavedMonth();
    await createTreasury(building.id, accessToken);
    const { charges } = await publish(building.id, accessToken);
    const url = `/api/v1/water-charges/public/${charges[0].publicCode}/demo-funds`;
    const payer = fakeAccountId();

    // The wallet does not exist yet.
    await request(app.getHttpServer())
      .post(url)
      .send({ payerAddress: payer })
      .expect(400);

    stellar.addAccount({ publicKey: payer, balance: '20.0000000' });
    const sent = await request(app.getHttpServer())
      .post(url)
      .send({ payerAddress: payer })
      .expect(200);
    expect(sent.body.amount).toBe('2.2800000');
    expect(sent.body.txHash).toEqual(expect.any(String));

    const nothing = await request(app.getHttpServer())
      .post(url)
      .send({ payerAddress: payer })
      .expect(200);
    expect(nothing.body).toEqual({ txHash: null, amount: '0.0000000' });

    await expect(
      prisma.waterCharge.findUniqueOrThrow({ where: { id: charges[0].id } }),
    ).resolves.toEqual(expect.objectContaining({ faucetDrips: 1 }));

    const next = await request(app.getHttpServer())
      .get('/api/v1/water-charges/public/demo/next')
      .expect(200);
    expect(charges.map((charge) => charge.publicCode)).toContain(
      next.body.code,
    );
  });

  it('removes the charges and the treasury with the building', async () => {
    const { building, accessToken } = await buildingWithSavedMonth();
    await createTreasury(building.id, accessToken);
    await publish(building.id, accessToken);

    await prisma.building.delete({ where: { id: building.id } });

    await expect(prisma.waterCharge.count()).resolves.toBe(0);
    await expect(prisma.buildingTreasury.count()).resolves.toBe(0);
  });
});
