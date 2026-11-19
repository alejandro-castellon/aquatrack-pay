import { TreasuryWatcherScheduler } from '@/modules/water-charge/infrastructure/schedulers/treasury-watcher.scheduler';
import { ReconcileTreasuryTransfersUseCase } from '@/modules/water-charge/application/use-cases/reconcile-treasury-transfers';
import { STELLAR_CONFIG } from '../../__fixtures__/mock-types';

describe('TreasuryWatcherScheduler', () => {
  let reconcile: { execute: jest.Mock };

  const build = (watcherIntervalMs: number | null) =>
    new TreasuryWatcherScheduler(
      { ...STELLAR_CONFIG, watcherIntervalMs },
      reconcile as unknown as ReconcileTreasuryTransfersUseCase,
    );

  beforeEach(() => {
    jest.useFakeTimers();
    reconcile = {
      execute: jest.fn().mockResolvedValue({ treasuries: 0, settled: 0 }),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('never polls while no interval is configured', () => {
    const scheduler = build(null);

    scheduler.onModuleInit();
    jest.advanceTimersByTime(60 * 60 * 1000);

    expect(reconcile.execute).not.toHaveBeenCalled();
    scheduler.onModuleDestroy();
  });

  it('reconciles on every interval once configured', async () => {
    const scheduler = build(10_000);

    scheduler.onModuleInit();
    expect(reconcile.execute).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(10_000);
    expect(reconcile.execute).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(20_000);
    expect(reconcile.execute).toHaveBeenCalledTimes(3);
    scheduler.onModuleDestroy();
  });

  it('stops when the module is destroyed', async () => {
    const scheduler = build(10_000);

    scheduler.onModuleInit();
    scheduler.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(reconcile.execute).not.toHaveBeenCalled();
  });

  it('skips a tick while the previous pass is still running', async () => {
    let finish: () => void = () => undefined;
    reconcile.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ treasuries: 1, settled: 0 });
        }),
    );
    const scheduler = build(10_000);

    const first = scheduler.tick();
    await scheduler.tick();
    expect(reconcile.execute).toHaveBeenCalledTimes(1);

    finish();
    await first;

    // Once the first pass is over, the next tick runs again.
    const second = scheduler.tick();
    expect(reconcile.execute).toHaveBeenCalledTimes(2);
    finish();
    await second;
  });

  it('swallows a failing pass and runs the next one', async () => {
    reconcile.execute
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValueOnce({ treasuries: 1, settled: 1 });
    const scheduler = build(10_000);

    await expect(scheduler.tick()).resolves.toBeUndefined();
    await expect(scheduler.tick()).resolves.toBeUndefined();

    expect(reconcile.execute).toHaveBeenCalledTimes(2);
  });
});
