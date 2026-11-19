import { StellarConfig } from './stellar.config';

type ExplorerConfig = Pick<StellarConfig, 'explorerUrl'>;

/** Public page of a transaction in the block explorer. */
export function txUrl(config: ExplorerConfig, hash: string): string {
  return `${config.explorerUrl}/tx/${hash}`;
}

/** Public page of an account in the block explorer. */
export function accountUrl(config: ExplorerConfig, publicKey: string): string {
  return `${config.explorerUrl}/account/${publicKey}`;
}
