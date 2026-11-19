import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import stellarConfig, { StellarConfig } from '@/shared/stellar/stellar.config';
import { ReconcileTreasuryTransfersUseCase } from '@modules/water-charge/application/use-cases/reconcile-treasury-transfers';

/**
 * Polls the treasuries for payments made outside the app. Off unless
 * STELLAR_WATCHER_INTERVAL_MS is set, so tests and production never reach
 * Horizon on their own. A plain interval, like the device-command timeouts.
 */
@Injectable()
export class TreasuryWatcherScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TreasuryWatcherScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(stellarConfig.KEY)
    private readonly config: StellarConfig,
    private readonly reconcileTreasuryTransfersUseCase: ReconcileTreasuryTransfersUseCase,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.watcherIntervalMs;
    if (!intervalMs) return;

    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.logger.log(`Watching treasuries every ${intervalMs} ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. A pass still running when the next one is due makes it skip. */
  async tick(): Promise<void> {
    if (this.running) return;

    this.running = true;
    try {
      await this.reconcileTreasuryTransfersUseCase.execute();
    } catch (error) {
      this.logger.error('Unable to reconcile treasury transfers', error);
    } finally {
      this.running = false;
    }
  }
}
