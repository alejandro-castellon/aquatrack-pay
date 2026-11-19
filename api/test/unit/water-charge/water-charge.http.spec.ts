import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { BuildingTreasuryController } from '@/modules/water-charge/infrastructure/controllers/building-treasury.controller';
import { WaterChargeController } from '@/modules/water-charge/infrastructure/controllers/water-charge.controller';
import { WaterChargePublicController } from '@/modules/water-charge/infrastructure/controllers/water-charge-public.controller';
import { TreasuryViewService } from '@/modules/water-charge/application/services/treasury-view.service';
import { CreateBuildingTreasuryUseCase } from '@/modules/water-charge/application/use-cases/create-building-treasury';
import { GetBuildingTreasuryUseCase } from '@/modules/water-charge/application/use-cases/get-building-treasury';
import { PublishWaterChargesUseCase } from '@/modules/water-charge/application/use-cases/publish-water-charges';
import { ListWaterChargesByBuildingUseCase } from '@/modules/water-charge/application/use-cases/list-water-charges-by-building';
import { ListWaterChargesByApartmentUseCase } from '@/modules/water-charge/application/use-cases/list-water-charges-by-apartment';
import { GetPublicWaterChargeUseCase } from '@/modules/water-charge/application/use-cases/get-public-water-charge';
import { ConfirmWaterChargeTransferUseCase } from '@/modules/water-charge/application/use-cases/confirm-water-charge-transfer';
import { ReconcileTreasuryTransfersUseCase } from '@/modules/water-charge/application/use-cases/reconcile-treasury-transfers';
import { RequestDemoFundsUseCase } from '@/modules/water-charge/application/use-cases/request-demo-funds';
import { GetNextDemoChargeUseCase } from '@/modules/water-charge/application/use-cases/get-next-demo-charge';
import { WATER_CHARGE_REPOSITORY } from '@/modules/water-charge/domain/water-charge.repository.interface';
import { BUILDING_TREASURY_REPOSITORY } from '@/modules/water-charge/domain/building-treasury.repository.interface';
import {
  CHARGE_MEMO_PATTERN,
  PUBLIC_CODE_PATTERN,
} from '@/modules/water-charge/domain/services/charge-reference';
import { BUILDING_REPOSITORY } from '@/modules/building/domain/building.repository.interface';
import { APARTMENT_REPOSITORY } from '@/modules/apartment/domain/apartment.repository.interface';
import { APARTMENT_MONTHLY_CONSUMPTION_REPOSITORY } from '@/modules/apartment-consumption/domain/apartment-consumption.repository.interface';
import { JwtAuthGuard } from '@/modules/auth/infrastructure/guards/jwt-auth.guard';
import stellarConfig from '@/shared/stellar/stellar.config';
import { STELLAR_GATEWAY } from '@/shared/stellar/stellar-gateway.interface';
import { fromStroops, toStroops } from '@/shared/stellar/stellar-amount';
import {
  FakeStellarGateway,
  fakeAccountId,
  fakeTxHash,
} from '@test/utils/fake-stellar-gateway';
import { BuildingFixtures } from '../building/__fixtures__/building.fixtures';
import { ApartmentFixtures } from '../apartment/__fixtures__/apartment.fixtures';
import {
  ChargeContext,
  InMemoryBuildingTreasuryRepository,
  InMemoryWaterChargeRepository,
} from './__fixtures__/in-memory-repositories';
import { STELLAR_CONFIG } from './__fixtures__/mock-types';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A UUID typed as a plain string, so it can key the fixture maps. */
const uuid = (): string => randomUUID();

/** Stands in for the JWT guard: the caller comes in two test headers. */
const headerAuth: CanActivate = {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: { sub: string; role: string };
    }>();
    const sub = req.headers['x-test-user'];
    const role = req.headers['x-test-role'];
    if (!sub || !role) throw new UnauthorizedException('No token provided');
    req.user = { sub, role };
    return true;
  },
};

/**
 * The whole feature over HTTP, with the real controllers, pipes, roles guard
 * and use-cases. Only the outside is replaced: repositories are in memory
 * and Stellar is the fake gateway. It is the closest thing to the e2e spec
 * that runs without Postgres. The tests are one story and run in order.
 */
describe('AquaTrack Pay over HTTP', () => {
  const BUILDING = uuid();
  const ADMIN = 'admin-of-the-building';
  const OUTSIDER = 'admin-of-another-building';
  const OWNER = 'owner-of-101';
  const TENANT = 'tenant-of-101';
  const OTHER_OWNER = 'owner-of-102';
  const APT_101 = uuid();
  const APT_102 = uuid();
  const APT_103 = uuid();
  const MONTH = '2026-10';
  const EARLIER_MONTH = '2026-09';

  const admin = { 'x-test-user': ADMIN, 'x-test-role': 'admin' };
  const outsider = { 'x-test-user': OUTSIDER, 'x-test-role': 'admin' };
  const owner = { 'x-test-user': OWNER, 'x-test-role': 'owner' };
  const tenant = { 'x-test-user': TENANT, 'x-test-role': 'tenant' };
  const otherOwner = { 'x-test-user': OTHER_OWNER, 'x-test-role': 'owner' };
  const superAdmin = { 'x-test-user': 'root', 'x-test-role': 'super_admin' };

  const signers = [
    { publicKey: fakeAccountId(), label: 'Administrador' },
    { publicKey: fakeAccountId(), label: 'Presidenta de la directiva' },
    { publicKey: fakeAccountId(), label: 'Tesorero' },
  ];
  const payer = fakeAccountId();
  const neighbour = fakeAccountId();

  const monthlyRow = (
    apartmentId: string,
    apartmentNumber: string,
    month: string,
    payment: number,
  ) => ({
    id: uuid(),
    apartmentId,
    month,
    payment,
    consumption: payment / 13.5,
    avgDailyUsage: 0.3,
    peakDayUsage: 0.6,
    periodStartDate: new Date(`${month}-01T00:00:00.000Z`),
    periodEndDate: new Date(`${month}-28T00:00:00.000Z`),
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    apartmentNumber,
    apartmentFloor: Number(apartmentNumber[0]),
  });
  const rows = [
    monthlyRow(APT_102, '102', MONTH, 111.6),
    monthlyRow(APT_101, '101', MONTH, 155),
    monthlyRow(APT_103, '103', MONTH, 0),
    monthlyRow(APT_103, '103', EARLIER_MONTH, 69.6),
  ];

  const buildings = new Map([
    [
      BUILDING,
      BuildingFixtures.createBuilding({
        id: BUILDING,
        name: 'Edificio Los Álamos',
        adminIds: [ADMIN],
      }),
    ],
  ]);
  const apartments = new Map(
    [
      { id: APT_101, apartmentNumber: '101', ownerId: OWNER, tenantId: TENANT },
      { id: APT_102, apartmentNumber: '102', ownerId: OTHER_OWNER },
      { id: APT_103, apartmentNumber: '103', ownerId: null },
    ].map((apartment) => [
      apartment.id,
      ApartmentFixtures.createApartment({
        ...apartment,
        tenantId: apartment.tenantId ?? null,
        buildingId: BUILDING,
        floor: 1,
      }),
    ]),
  );

  const context: ChargeContext = {
    buildingNames: new Map([[BUILDING, 'Edificio Los Álamos']]),
    apartments: new Map(
      [...apartments.values()].map((apartment) => [
        apartment.id,
        { apartmentNumber: apartment.apartmentNumber, floor: apartment.floor },
      ]),
    ),
    monthlyRows: new Map(
      rows.map((row) => [
        row.id,
        {
          consumption: row.consumption,
          periodStartDate: row.periodStartDate,
          periodEndDate: row.periodEndDate,
        },
      ]),
    ),
  };

  const stellar = new FakeStellarGateway();
  const treasuryRepository = new InMemoryBuildingTreasuryRepository();
  const chargeRepository = new InMemoryWaterChargeRepository(
    context,
    treasuryRepository,
  );
  treasuryRepository.pendingTreasuryIds = () =>
    chargeRepository.charges
      .filter((charge) => charge.isPending)
      .map((charge) => charge.treasuryId);

  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let treasuryKey: string;
  /** What reached the treasury in the charge asset, to check its balance. */
  let received = 0n;

  /** A payment to the treasury in the charge asset, tracked for the balance. */
  const payTreasury = (
    from: string,
    amounts: string[],
    memo: string | null,
    feeBump = false,
  ) => {
    for (const amount of amounts) received += toStroops(amount);
    return stellar.registerPayment({
      from,
      to: treasuryKey,
      amounts,
      memo,
      feeBump,
    });
  };

  const chargeOf = async (apartmentNumber: string, month = MONTH) => {
    const { body } = await http
      .get(`/api/v1/water-charges/by-building/${BUILDING}`)
      .query({ month })
      .set(admin)
      .expect(200);
    return (
      body as { apartmentNumber: string; publicCode: string; memo: string }[]
    ).find((charge) => charge.apartmentNumber === apartmentNumber)!;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        BuildingTreasuryController,
        WaterChargeController,
        WaterChargePublicController,
      ],
      providers: [
        TreasuryViewService,
        CreateBuildingTreasuryUseCase,
        GetBuildingTreasuryUseCase,
        PublishWaterChargesUseCase,
        ListWaterChargesByBuildingUseCase,
        ListWaterChargesByApartmentUseCase,
        GetPublicWaterChargeUseCase,
        ConfirmWaterChargeTransferUseCase,
        ReconcileTreasuryTransfersUseCase,
        RequestDemoFundsUseCase,
        GetNextDemoChargeUseCase,
        { provide: WATER_CHARGE_REPOSITORY, useValue: chargeRepository },
        { provide: BUILDING_TREASURY_REPOSITORY, useValue: treasuryRepository },
        {
          provide: BUILDING_REPOSITORY,
          useValue: {
            findById: (id: string) =>
              Promise.resolve(buildings.get(id) ?? null),
          },
        },
        {
          provide: APARTMENT_REPOSITORY,
          useValue: {
            findById: (id: string) =>
              Promise.resolve(apartments.get(id) ?? null),
          },
        },
        {
          provide: APARTMENT_MONTHLY_CONSUMPTION_REPOSITORY,
          useValue: {
            findByBuildingIdAndMonth: (buildingId: string, month: string) =>
              Promise.resolve(
                buildingId === BUILDING
                  ? rows.filter((row) => row.month === month)
                  : [],
              ),
          },
        },
        { provide: STELLAR_GATEWAY, useValue: stellar },
        { provide: stellarConfig.KEY, useValue: STELLAR_CONFIG },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(headerAuth)
      .compile();

    app = moduleRef.createNestApplication();
    // Same pipe and prefix as main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('asks for a session on admin and resident routes, not on a pay link', async () => {
    await http.get(`/api/v1/buildings/${BUILDING}/treasury`).expect(401);
    await http
      .get(`/api/v1/water-charges/by-building/${BUILDING}`)
      .query({ month: MONTH })
      .expect(401);
    await http.get(`/api/v1/water-charges/by-apartment/${APT_101}`).expect(401);
    await http
      .post('/api/v1/water-charges/publish')
      .send({ buildingId: BUILDING, month: MONTH })
      .expect(401);

    // Public: an unknown code is simply not found.
    await http
      .get('/api/v1/water-charges/public/0000000000000000000a')
      .expect(404);
  });

  it('starts without a treasury and cannot publish yet', async () => {
    const { body } = await http
      .get(`/api/v1/buildings/${BUILDING}/treasury`)
      .set(admin)
      .expect(200);
    expect(body).toEqual({ treasury: null });

    await http
      .post('/api/v1/water-charges/publish')
      .set(admin)
      .send({ buildingId: BUILDING, month: MONTH, bsPerUsdc: 6.96 })
      .expect(409);
  });

  it('rejects a malformed treasury request', async () => {
    const post = (body: object) =>
      http.post(`/api/v1/buildings/${BUILDING}/treasury`).set(admin).send(body);

    await post({ signers: [], threshold: 1 }).expect(400);
    await post({
      signers: [{ publicKey: 'not-an-account', label: 'Admin' }],
      threshold: 1,
    }).expect(400);
    await post({ signers, threshold: 0 }).expect(400);
    await post({ signers, threshold: 2, extra: true }).expect(400);
    await post({ signers, threshold: 4 }).expect(400);
    await post({ signers: [signers[0], signers[0]], threshold: 1 }).expect(400);
    await http
      .post('/api/v1/buildings/not-a-uuid/treasury')
      .set(admin)
      .send({ signers, threshold: 2 })
      .expect(400);
  });

  it('only lets the building admins create its treasury', async () => {
    const url = `/api/v1/buildings/${BUILDING}/treasury`;

    await http
      .post(url)
      .set(outsider)
      .send({ signers, threshold: 2 })
      .expect(403);
    await http.post(url).set(owner).send({ signers, threshold: 2 }).expect(403);
    await http.get(url).set(outsider).expect(403);
    await http.get(url).set(tenant).expect(403);
    await http
      .post(`/api/v1/buildings/${uuid()}/treasury`)
      .set(admin)
      .send({ signers, threshold: 2 })
      .expect(404);
  });

  it('creates a 2-of-3 treasury nobody can move alone', async () => {
    const { body } = await http
      .post(`/api/v1/buildings/${BUILDING}/treasury`)
      .set(admin)
      .send({ signers, threshold: 2 })
      .expect(201);

    treasuryKey = body.treasury.publicKey;
    expect(body.treasury).toEqual({
      publicKey: expect.stringMatching(/^G[A-Z2-7]{55}$/),
      network: 'testnet',
      assetCode: 'USDC',
      assetIssuer: STELLAR_CONFIG.assetIssuer,
      threshold: 2,
      signers,
      setupTxHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      createdAt: expect.any(String),
      explorerUrl: `${STELLAR_CONFIG.explorerUrl}/account/${treasuryKey}`,
      onChain: {
        balance: '0.0000000',
        xlmBalance: '5.0000000',
        masterWeight: 0,
        thresholds: { low: 2, med: 2, high: 2 },
        signers: signers.map(({ publicKey }) => ({ publicKey, weight: 1 })),
      },
      transfers: [],
    });
    expect(JSON.stringify(body)).not.toMatch(UUID);

    await http
      .post(`/api/v1/buildings/${BUILDING}/treasury`)
      .set(admin)
      .send({ signers, threshold: 2 })
      .expect(409);
  });

  it('publishes one charge per apartment that owes, in apartment order', async () => {
    const { body } = await http
      .post('/api/v1/water-charges/publish')
      .set(admin)
      .send({ buildingId: BUILDING, month: MONTH, bsPerUsdc: 6.96 })
      .expect(201);

    expect(body.created).toBe(2);
    expect(body.charges).toEqual([
      expect.objectContaining({
        apartmentId: APT_101,
        apartmentNumber: '101',
        apartmentFloor: 1,
        buildingId: BUILDING,
        month: MONTH,
        amountBs: 155,
        exchangeRate: 6.96,
        amountUsdc: '22.2800000',
        status: 'pending',
        memo: expect.stringMatching(CHARGE_MEMO_PATTERN),
        publicCode: expect.stringMatching(PUBLIC_CODE_PATTERN),
        txHash: null,
        payerAddress: null,
        paidAmountUsdc: null,
        paidAt: null,
        explorerUrl: null,
      }),
      expect.objectContaining({
        apartmentNumber: '102',
        amountBs: 111.6,
        amountUsdc: '16.0400000',
      }),
    ]);
  });

  it('publishes the same month again without touching the charges', async () => {
    const before = await chargeOf('101');

    const { body } = await http
      .post('/api/v1/water-charges/publish')
      .set(admin)
      .send({ buildingId: BUILDING, month: MONTH, bsPerUsdc: 9.99 })
      .expect(201);

    expect(body.created).toBe(0);
    expect(body.charges).toHaveLength(2);
    expect(body.charges[0]).toEqual(
      expect.objectContaining({
        memo: before.memo,
        publicCode: before.publicCode,
        exchangeRate: 6.96,
        amountUsdc: '22.2800000',
      }),
    );
  });

  it('validates what is published and who publishes', async () => {
    const publish = (body: object, headers = admin) =>
      http.post('/api/v1/water-charges/publish').set(headers).send(body);

    await publish({ buildingId: BUILDING, month: '2026-13' }).expect(400);
    await publish({ buildingId: 'nope', month: MONTH }).expect(400);
    await publish({ buildingId: BUILDING, month: MONTH, bsPerUsdc: -1 }).expect(
      400,
    );
    await publish({
      buildingId: BUILDING,
      month: MONTH,
      bsPerUsdc: 6.96001,
    }).expect(400);
    // No rate in the request and none configured.
    await publish({ buildingId: BUILDING, month: MONTH }).expect(400);
    // A month nobody saved.
    await publish({
      buildingId: BUILDING,
      month: '2026-01',
      bsPerUsdc: 6.96,
    }).expect(404);
    await publish(
      { buildingId: BUILDING, month: MONTH, bsPerUsdc: 6.96 },
      outsider,
    ).expect(403);
    await publish(
      { buildingId: BUILDING, month: MONTH, bsPerUsdc: 6.96 },
      owner,
    ).expect(403);
  });

  it('lists a building month for its admins only', async () => {
    const url = `/api/v1/water-charges/by-building/${BUILDING}`;

    const { body } = await http
      .get(url)
      .query({ month: MONTH })
      .set(admin)
      .expect(200);
    expect(
      body.map((charge: { apartmentNumber: string }) => charge.apartmentNumber),
    ).toEqual(['101', '102']);

    await http.get(url).query({ month: MONTH }).set(superAdmin).expect(200);
    await http.get(url).query({ month: MONTH }).set(outsider).expect(403);
    await http.get(url).query({ month: MONTH }).set(owner).expect(403);
    await http.get(url).set(admin).expect(400);
    await http.get(url).query({ month: 'octubre' }).set(admin).expect(400);
  });

  it('shows a resident the charges of their own apartment only', async () => {
    const url = (apartmentId: string) =>
      `/api/v1/water-charges/by-apartment/${apartmentId}`;

    const mine = await http.get(url(APT_101)).set(owner).expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toEqual(
      expect.objectContaining({ apartmentNumber: '101', amountBs: 155 }),
    );

    await http.get(url(APT_101)).set(tenant).expect(200);
    await http.get(url(APT_101)).set(admin).expect(200);
    await http.get(url(APT_101)).set(otherOwner).expect(403);
    await http.get(url(APT_102)).set(tenant).expect(403);
    await http.get(url(APT_101)).set(outsider).expect(403);
    await http.get(url(uuid())).set(admin).expect(404);
    await http.get(url('not-a-uuid')).set(admin).expect(400);
  });

  it('opens the pay link without a session and without identifiers', async () => {
    const charge = await chargeOf('101');

    const { body } = await http
      .get(`/api/v1/water-charges/public/${charge.publicCode}`)
      .expect(200);

    expect(body).toEqual({
      buildingName: 'Edificio Los Álamos',
      apartmentNumber: '101',
      month: MONTH,
      periodStartDate: '2026-10-01',
      periodEndDate: '2026-10-28',
      consumption: 155 / 13.5,
      amountBs: 155,
      exchangeRate: 6.96,
      amountUsdc: '22.2800000',
      status: 'pending',
      payment: {
        destination: treasuryKey,
        assetCode: 'USDC',
        assetIssuer: STELLAR_CONFIG.assetIssuer,
        memo: charge.memo,
        network: 'testnet',
        networkPassphrase: 'Test SDF Network ; September 2015',
      },
      paid: null,
      demo: { faucetEnabled: true },
    });
    expect(JSON.stringify(body)).not.toMatch(UUID);

    // The memo is public on the ledger: it must not open the page.
    await http.get(`/api/v1/water-charges/public/${charge.memo}`).expect(404);
    await http.get('/api/v1/water-charges/public/short').expect(404);
  });

  it('hands the demo a pending charge to try', async () => {
    const { body } = await http
      .get('/api/v1/water-charges/public/demo/next')
      .expect(200);

    expect(body.code).toMatch(PUBLIC_CODE_PATTERN);
    await http.get(`/api/v1/water-charges/public/${body.code}`).expect(200);
  });

  it('gives test funds only to an existing wallet, and only the shortfall', async () => {
    const { publicCode } = await chargeOf('101');
    const ask = (payerAddress: string) =>
      http
        .post(`/api/v1/water-charges/public/${publicCode}/demo-funds`)
        .send({ payerAddress });

    await ask('not-an-account').expect(400);
    // The wallet is not on the network yet.
    await ask(payer).expect(400);
    // It exists but cannot hold the asset.
    stellar.addAccount({ publicKey: payer, balance: null });
    await ask(payer).expect(400);

    stellar.addAccount({ publicKey: payer, balance: '0.0000000' });
    const first = await ask(payer).expect(200);
    expect(first.body).toEqual({
      txHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      amount: '22.2800000',
    });

    // The wallet now covers the charge: nothing else is sent.
    const second = await ask(payer).expect(200);
    expect(second.body).toEqual({ txHash: null, amount: '0.0000000' });
  });

  it('does not settle with a transaction that does not pay the charge', async () => {
    const { publicCode, memo } = await chargeOf('101');
    const confirm = (txHash: string) =>
      http
        .post(`/api/v1/water-charges/public/${publicCode}/confirm`)
        .send({ txHash });

    await confirm('xyz').expect(400);
    await http
      .post(`/api/v1/water-charges/public/${publicCode}/confirm`)
      .send({ txHash: fakeTxHash(), memo })
      .expect(400);

    const unknown = await confirm(fakeTxHash()).expect(200);
    expect(unknown.body.outcome).toBe('not_found_yet');

    const elsewhere = stellar.registerPayment({
      from: payer,
      to: fakeAccountId(),
      amounts: ['22.2800000'],
      memo,
    });
    const notOurs = await confirm(elsewhere.txHash).expect(200);
    expect(notOurs.body.outcome).toBe('not_a_payment');

    const otherMemo = payTreasury(neighbour, ['22.2800000'], 'AQT-0000000000');
    const wrongMemo = await confirm(otherMemo.txHash).expect(200);
    expect(wrongMemo.body.outcome).toBe('wrong_memo');

    const short = payTreasury(neighbour, ['22.2700000'], memo);
    const underpaid = await confirm(short.txHash).expect(200);
    expect(underpaid.body.outcome).toBe('underpaid');
    expect(underpaid.body.charge.status).toBe('pending');
    expect(underpaid.body.charge.paid).toBeNull();
  });

  it('settles with the transaction that pays, recording the ledger hash', async () => {
    const { publicCode, memo } = await chargeOf('101');
    // Sponsored fee: the wallet reports the inner hash, the ledger keeps the outer.
    const payment = payTreasury(
      payer,
      ['12.2800000', '10.0000000'],
      memo,
      true,
    );

    const { body } = await http
      .post(`/api/v1/water-charges/public/${publicCode}/confirm`)
      .send({ txHash: payment.innerHash })
      .expect(200);

    expect(body.outcome).toBe('paid');
    expect(body.charge.status).toBe('paid');
    expect(body.charge.paid).toEqual({
      txHash: payment.txHash,
      paidAt: expect.any(String),
      paidAmountUsdc: '22.2800000',
      payerAddress: payer,
      explorerUrl: `${STELLAR_CONFIG.explorerUrl}/tx/${payment.txHash}`,
    });

    const again = await http
      .post(`/api/v1/water-charges/public/${publicCode}/confirm`)
      .send({ txHash: payment.txHash })
      .expect(200);
    expect(again.body.outcome).toBe('already_paid');
    expect(again.body.charge.paid.txHash).toBe(payment.txHash);

    // A paid charge gets no more test funds.
    await http
      .post(`/api/v1/water-charges/public/${publicCode}/demo-funds`)
      .send({ payerAddress: payer })
      .expect(409);

    const listed = await http
      .get(`/api/v1/water-charges/by-apartment/${APT_101}`)
      .set(owner)
      .expect(200);
    expect(listed.body[0]).toEqual(
      expect.objectContaining({
        status: 'paid',
        txHash: payment.txHash,
        payerAddress: payer,
        paidAmountUsdc: '22.2800000',
        explorerUrl: `${STELLAR_CONFIG.explorerUrl}/tx/${payment.txHash}`,
      }),
    );
  });

  it('settles on its own a payment made from another wallet', async () => {
    const { memo } = await chargeOf('102');
    // Typed by hand in another wallet: lower case, nobody confirms it.
    const payment = payTreasury(neighbour, ['16.0400000'], memo.toLowerCase());
    const reconcile = app.get(ReconcileTreasuryTransfersUseCase);

    await expect(reconcile.execute()).resolves.toEqual({
      treasuries: 1,
      settled: 1,
    });

    const charge = await chargeOf('102');
    expect(charge).toEqual(
      expect.objectContaining({
        status: 'paid',
        txHash: payment.txHash,
        payerAddress: neighbour,
        paidAmountUsdc: '16.0400000',
      }),
    );
    // Nothing is pending any more, so there is nothing left to watch.
    await expect(reconcile.execute()).resolves.toEqual({
      treasuries: 0,
      settled: 0,
    });
    await http.get('/api/v1/water-charges/public/demo/next').expect(404);
  });

  it('settles what arrived when the admin opens the treasury', async () => {
    await http
      .post('/api/v1/water-charges/publish')
      .set(admin)
      .send({ buildingId: BUILDING, month: EARLIER_MONTH, bsPerUsdc: 6.96 })
      .expect(201);
    const pending = await chargeOf('103', EARLIER_MONTH);
    const payment = payTreasury(neighbour, ['10.0000000'], pending.memo);

    const { body } = await http
      .get(`/api/v1/buildings/${BUILDING}/treasury`)
      .set(admin)
      .expect(200);

    expect(body.treasury.onChain.balance).toBe(fromStroops(received));
    expect(
      body.treasury.transfers.map(
        (transfer: { status: string; amountUsdc: string }) => [
          transfer.status,
          transfer.amountUsdc,
        ],
      ),
    ).toEqual([
      // Newest first.
      ['matched', '10.0000000'],
      ['matched', '16.0400000'],
      ['matched', '22.2800000'],
      // The short payment carries the memo of a charge settled by another one.
      ['duplicate', '22.2700000'],
      ['unmatched', '22.2800000'],
    ]);
    expect(body.treasury.transfers[0]).toEqual({
      txHash: payment.txHash,
      createdAt: expect.any(String),
      payerAddress: neighbour,
      amountUsdc: '10.0000000',
      memo: pending.memo,
      status: 'matched',
      apartmentNumber: '103',
      month: EARLIER_MONTH,
      explorerUrl: `${STELLAR_CONFIG.explorerUrl}/tx/${payment.txHash}`,
    });
    expect(body.treasury.transfers[4]).toEqual(
      expect.objectContaining({
        memo: 'AQT-0000000000',
        apartmentNumber: null,
        month: null,
      }),
    );
    expect((await chargeOf('103', EARLIER_MONTH)).publicCode).toBe(
      pending.publicCode,
    );
    await http
      .get(`/api/v1/water-charges/public/${pending.publicCode}`)
      .expect(200)
      .expect(({ body: charge }) => expect(charge.status).toBe('paid'));
  });

  it('keeps answering when Stellar cannot be reached', async () => {
    const charge = await chargeOf('101');
    stellar.down = true;

    try {
      const { body } = await http
        .get(`/api/v1/buildings/${BUILDING}/treasury`)
        .set(admin)
        .expect(200);
      expect(body.treasury.publicKey).toBe(treasuryKey);
      expect(body.treasury.onChain).toBeNull();
      expect(body.treasury.transfers).toEqual([]);

      // What is already known does not need the network.
      await http
        .get(`/api/v1/water-charges/public/${charge.publicCode}`)
        .expect(200);
      await http
        .post(`/api/v1/water-charges/public/${charge.publicCode}/confirm`)
        .send({ txHash: fakeTxHash() })
        .expect(200)
        .expect(({ body: result }) =>
          expect(result.outcome).toBe('already_paid'),
        );
    } finally {
      stellar.down = false;
    }
  });
});
