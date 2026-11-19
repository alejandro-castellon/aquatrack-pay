import { WaterChargeRepositoryInterface } from '@/modules/water-charge/domain/water-charge.repository.interface';
import { BuildingTreasuryRepositoryInterface } from '@/modules/water-charge/domain/building-treasury.repository.interface';
import {
  WaterChargeEntity,
  WaterChargeProps,
  WaterChargeView,
} from '@/modules/water-charge/domain/water-charge.entity';
import {
  BuildingTreasuryEntity,
  BuildingTreasuryProps,
} from '@/modules/water-charge/domain/building-treasury.entity';
import { StellarGateway } from '@/shared/stellar/stellar-gateway.interface';
import { StellarConfig } from '@/shared/stellar/stellar.config';
import { HorizonAccount } from '@/shared/stellar/horizon.types';
import { MEMO, TREASURY, USDC_ISSUER } from './horizon.fixtures';

export const BUILDING_ID = '9f7b3a46-946e-4e75-a0f3-dce1c07e7f4a';
export const APARTMENT_ID = 'a1b2c3d4-e5f6-4890-abcd-1234567890ab';
export const TREASURY_ID = '3f2b7c1e-9a4d-4f6b-8c2e-5d7a9b1c3e4f';
export const CHARGE_ID = '6d1f0a9e-2b3c-4d5e-8f70-112233445566';
export const MONTHLY_ROW_ID = '0c9b8a7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
export const ADMIN_ID = '550e8400-e29b-41d4-a716-446655440000';
export const PUBLIC_CODE = '7f3k2m9qxz0a1b2c3d4e';
export const TX_HASH =
  'cce693a4c66c1579b2523d91b99fdd2fdd649647149814cfc1b2a560a5013f93';
export const SIGNER_A =
  'GAKQZFNHCK3DGMXN4VOPBGGPYTN67VJF47V5T6FPU3WOCWIUG3B75SST';
export const SIGNER_B =
  'GBHJPTVKJ2E6M4TRRPMNJMJ6IZLTRS3AGDOPIVL6Y3CLVZ33BMBQEH6P';
export const SIGNER_C =
  'GACECUEKEQW577GW2WRAN2JY5ZSTABQNXWH5XTYKF3DOBQDQFXS2GNUR';

export const STELLAR_CONFIG: StellarConfig = {
  network: 'testnet',
  networkPassphrase: 'Test SDF Network ; September 2015',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  explorerUrl: 'https://stellar.expert/explorer/testnet',
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
  opsSecret: null,
  watcherIntervalMs: null,
  demoFaucetEnabled: true,
  defaultBsPerUsdc: null,
  demoBuildingId: null,
};

export type MockWaterChargeRepository = {
  [K in keyof WaterChargeRepositoryInterface]: jest.Mock;
};

export function createMockWaterChargeRepository(): MockWaterChargeRepository {
  return {
    createManySkippingExisting: jest.fn(),
    findByBuildingIdAndMonth: jest.fn(),
    findByApartmentId: jest.fn(),
    findByPublicCode: jest.fn(),
    findByTreasuryIdAndMemos: jest.fn().mockResolvedValue([]),
    settle: jest.fn(),
    reserveFaucetDrip: jest.fn(),
    releaseFaucetDrip: jest.fn(),
    findRandomPendingPublicCode: jest.fn(),
  };
}

export type MockBuildingTreasuryRepository = {
  [K in keyof BuildingTreasuryRepositoryInterface]: jest.Mock;
};

export function createMockBuildingTreasuryRepository(): MockBuildingTreasuryRepository {
  return {
    findByBuildingId: jest.fn(),
    create: jest.fn(),
    findWithPendingCharges: jest.fn(),
    updateCursor: jest.fn(),
  };
}

export type MockStellarGateway = {
  [K in keyof StellarGateway]: jest.Mock;
};

export function createMockStellarGateway(): MockStellarGateway {
  return {
    getAccount: jest.fn(),
    getTransactionOperations: jest.fn(),
    listAccountPayments: jest.fn().mockResolvedValue([]),
    createTreasuryAccount: jest.fn(),
    sendFromOps: jest.fn(),
    opsPublicKey: jest.fn(),
  };
}

export function createTreasury(
  overrides: Partial<BuildingTreasuryProps> = {},
): BuildingTreasuryEntity {
  return BuildingTreasuryEntity.fromPersistence({
    id: TREASURY_ID,
    buildingId: BUILDING_ID,
    network: 'testnet',
    publicKey: TREASURY,
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    signers: [
      { publicKey: SIGNER_A, label: 'Administrador' },
      { publicKey: SIGNER_B, label: 'Presidenta de la directiva' },
      { publicKey: SIGNER_C, label: 'Tesorero' },
    ],
    threshold: 2,
    setupTxHash: 'setup-hash',
    lastCursor: null,
    createdById: ADMIN_ID,
    createdAt: new Date('2026-11-18T12:00:00.000Z'),
    updatedAt: new Date('2026-11-18T12:00:00.000Z'),
    ...overrides,
  });
}

/** A pending charge of Bs 155 at 6.96, i.e. 22.28 USDC. */
export function createCharge(
  overrides: Partial<WaterChargeProps> = {},
): WaterChargeEntity {
  return WaterChargeEntity.fromPersistence({
    id: CHARGE_ID,
    apartmentMonthlyConsumptionId: MONTHLY_ROW_ID,
    apartmentId: APARTMENT_ID,
    buildingId: BUILDING_ID,
    treasuryId: TREASURY_ID,
    month: '2026-10',
    amountBs: 155,
    exchangeRate: 6.96,
    amountUsdc: '22.2800000',
    memo: MEMO,
    publicCode: PUBLIC_CODE,
    status: 'pending',
    txHash: null,
    payerAddress: null,
    paidAmountUsdc: null,
    ledger: null,
    paidAt: null,
    faucetDrips: 0,
    createdById: ADMIN_ID,
    createdAt: new Date('2026-11-18T13:00:00.000Z'),
    updatedAt: new Date('2026-11-18T13:00:00.000Z'),
    ...overrides,
  });
}

export function createPaidCharge(
  overrides: Partial<WaterChargeProps> = {},
): WaterChargeEntity {
  return createCharge({
    status: 'paid',
    txHash: TX_HASH,
    payerAddress: SIGNER_C,
    paidAmountUsdc: '22.2800000',
    ledger: 1234,
    paidAt: new Date('2026-11-18T15:00:00.000Z'),
    ...overrides,
  });
}

export function createChargeView(
  chargeOverrides: Partial<WaterChargeProps> = {},
  viewOverrides: Partial<Omit<WaterChargeView, 'charge'>> = {},
): WaterChargeView {
  return {
    charge: createCharge(chargeOverrides),
    apartmentNumber: '101',
    apartmentFloor: 1,
    consumption: 77.5,
    periodStartDate: new Date('2026-10-01T00:00:00.000Z'),
    periodEndDate: new Date('2026-10-31T00:00:00.000Z'),
    buildingName: 'Edificio Central',
    treasury: {
      publicKey: TREASURY,
      network: 'testnet',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
    },
    ...viewOverrides,
  };
}

/** The treasury account as Horizon reports a 2-of-3 with its master key off. */
export function createTreasuryAccount(
  overrides: Partial<HorizonAccount> = {},
): HorizonAccount {
  return {
    id: TREASURY,
    account_id: TREASURY,
    sequence: '100',
    subentry_count: 4,
    thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
    signers: [
      { key: SIGNER_A, weight: 1, type: 'ed25519_public_key' },
      { key: SIGNER_B, weight: 1, type: 'ed25519_public_key' },
      { key: SIGNER_C, weight: 1, type: 'ed25519_public_key' },
      { key: TREASURY, weight: 0, type: 'ed25519_public_key' },
    ],
    balances: [
      {
        balance: '104.7300000',
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: USDC_ISSUER,
      },
      { balance: '4.9990000', asset_type: 'native' },
    ],
    ...overrides,
  };
}
