import { Module } from '@nestjs/common';
import { PrismaModule } from '@/shared/database/prisma.module';
import { RepositoriesModule } from '@/shared/database/repositories.module';
import { SharedAuthModule } from '@/shared/auth/shared-auth.module';
import { StellarModule } from '@/shared/stellar/stellar.module';
import { ApartmentConsumptionModule } from '@modules/apartment-consumption/apartment-consumption.module';
import { BuildingTreasuryController } from './infrastructure/controllers/building-treasury.controller';
import { WaterChargeController } from './infrastructure/controllers/water-charge.controller';
import { WaterChargePublicController } from './infrastructure/controllers/water-charge-public.controller';
import { PrismaWaterChargeRepository } from './infrastructure/repositories/prisma-water-charge.repository';
import { PrismaBuildingTreasuryRepository } from './infrastructure/repositories/prisma-building-treasury.repository';
import { TreasuryWatcherScheduler } from './infrastructure/schedulers/treasury-watcher.scheduler';
import { WATER_CHARGE_REPOSITORY } from './domain/water-charge.repository.interface';
import { BUILDING_TREASURY_REPOSITORY } from './domain/building-treasury.repository.interface';
import { TreasuryViewService } from './application/services/treasury-view.service';
import { CreateBuildingTreasuryUseCase } from './application/use-cases/create-building-treasury';
import { GetBuildingTreasuryUseCase } from './application/use-cases/get-building-treasury';
import { PublishWaterChargesUseCase } from './application/use-cases/publish-water-charges';
import { ListWaterChargesByBuildingUseCase } from './application/use-cases/list-water-charges-by-building';
import { ListWaterChargesByApartmentUseCase } from './application/use-cases/list-water-charges-by-apartment';
import { GetPublicWaterChargeUseCase } from './application/use-cases/get-public-water-charge';
import { ConfirmWaterChargeTransferUseCase } from './application/use-cases/confirm-water-charge-transfer';
import { ReconcileTreasuryTransfersUseCase } from './application/use-cases/reconcile-treasury-transfers';
import { RequestDemoFundsUseCase } from './application/use-cases/request-demo-funds';
import { GetNextDemoChargeUseCase } from './application/use-cases/get-next-demo-charge';

/**
 * Water charges payable on Stellar and the building treasury that receives
 * them. StellarModule brings the gateway and the `stellar` config namespace;
 * ApartmentConsumptionModule brings the saved monthly amounts.
 */
@Module({
  imports: [
    PrismaModule,
    RepositoriesModule,
    SharedAuthModule,
    StellarModule,
    ApartmentConsumptionModule,
  ],
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
    TreasuryWatcherScheduler,
    { provide: WATER_CHARGE_REPOSITORY, useClass: PrismaWaterChargeRepository },
    {
      provide: BUILDING_TREASURY_REPOSITORY,
      useClass: PrismaBuildingTreasuryRepository,
    },
  ],
})
export class WaterChargeModule {}
