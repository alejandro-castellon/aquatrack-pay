import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AppModule } from '@/app.module';
import { WaterChargeModule } from '@/modules/water-charge/water-charge.module';
import { BuildingTreasuryController } from '@/modules/water-charge/infrastructure/controllers/building-treasury.controller';
import { WaterChargeController } from '@/modules/water-charge/infrastructure/controllers/water-charge.controller';
import { WaterChargePublicController } from '@/modules/water-charge/infrastructure/controllers/water-charge-public.controller';
import { TreasuryWatcherScheduler } from '@/modules/water-charge/infrastructure/schedulers/treasury-watcher.scheduler';
import { PublishWaterChargesUseCase } from '@/modules/water-charge/application/use-cases/publish-water-charges';
import { ConfirmWaterChargeTransferUseCase } from '@/modules/water-charge/application/use-cases/confirm-water-charge-transfer';
import { WATER_CHARGE_REPOSITORY } from '@/modules/water-charge/domain/water-charge.repository.interface';
import { BUILDING_TREASURY_REPOSITORY } from '@/modules/water-charge/domain/building-treasury.repository.interface';
import { PrismaWaterChargeRepository } from '@/modules/water-charge/infrastructure/repositories/prisma-water-charge.repository';
import { PrismaBuildingTreasuryRepository } from '@/modules/water-charge/infrastructure/repositories/prisma-building-treasury.repository';
import { STELLAR_GATEWAY } from '@/shared/stellar/stellar-gateway.interface';
import { HorizonStellarGateway } from '@/shared/stellar/horizon-stellar.gateway';
import stellarConfig, { StellarConfig } from '@/shared/stellar/stellar.config';

/**
 * Compiles the real module graph (no database or network is touched until a
 * module is initialised): proves every provider of the feature resolves,
 * including the `stellar` config namespace that StellarModule brings in.
 */
describe('WaterChargeModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-key';

    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), WaterChargeModule],
    }).compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('resolves the controllers, use-cases and the watcher', () => {
    expect(module.get(BuildingTreasuryController)).toBeDefined();
    expect(module.get(WaterChargeController)).toBeDefined();
    expect(module.get(WaterChargePublicController)).toBeDefined();
    expect(module.get(PublishWaterChargesUseCase)).toBeDefined();
    expect(module.get(ConfirmWaterChargeTransferUseCase)).toBeDefined();
    expect(module.get(TreasuryWatcherScheduler)).toBeDefined();
  });

  it('binds the repository tokens to their Prisma implementations', () => {
    expect(module.get(WATER_CHARGE_REPOSITORY)).toBeInstanceOf(
      PrismaWaterChargeRepository,
    );
    expect(module.get(BUILDING_TREASURY_REPOSITORY)).toBeInstanceOf(
      PrismaBuildingTreasuryRepository,
    );
  });

  it('gets the Horizon gateway and the stellar config from StellarModule', () => {
    expect(module.get(STELLAR_GATEWAY, { strict: false })).toBeInstanceOf(
      HorizonStellarGateway,
    );

    const config = module.get<StellarConfig>(stellarConfig.KEY, {
      strict: false,
    });
    expect(config.network).toMatch(/^(testnet|public)$/);
    expect(config.assetCode).toBeTruthy();
  });

  it('is registered in the application module', () => {
    const imports: unknown[] = Reflect.getMetadata('imports', AppModule);

    expect(imports).toContain(WaterChargeModule);
  });
});
