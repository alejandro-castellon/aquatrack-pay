import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import stellarConfig from './stellar.config';
import { STELLAR_GATEWAY } from './stellar-gateway.interface';
import { HorizonStellarGateway } from './horizon-stellar.gateway';

@Module({
  imports: [ConfigModule.forFeature(stellarConfig)],
  providers: [{ provide: STELLAR_GATEWAY, useClass: HorizonStellarGateway }],
  exports: [STELLAR_GATEWAY, ConfigModule],
})
export class StellarModule {}
