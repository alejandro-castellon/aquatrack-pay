/**
 * The subset of Horizon's JSON this API reads. Field names are Horizon's own
 * (snake_case); see https://developers.stellar.org/docs/data/apis/horizon.
 */

export type HorizonMemoType = 'none' | 'text' | 'id' | 'hash' | 'return';

export interface HorizonTransaction {
  /**
   * The hash the transaction was looked up by. A fee bump answers to both its
   * outer and its inner hash, so this is not a stable identifier: use the
   * operation's `transaction_hash`, which is always the outer one.
   */
  hash: string;
  ledger: number;
  created_at: string;
  successful: boolean;
  source_account: string;
  fee_account?: string;
  memo_type: HorizonMemoType;
  memo?: string;
  inner_transaction?: { hash: string };
  fee_bump_transaction?: { hash: string };
}

export interface HorizonOperation {
  id: string;
  paging_token: string;
  /** payment, path_payment_strict_receive, create_account, invoke_host_function... */
  type: string;
  transaction_hash: string;
  transaction_successful: boolean;
  source_account: string;
  created_at: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  asset_code?: string;
  asset_issuer?: string;
  /** Present when the request used `join=transactions`. */
  transaction?: HorizonTransaction;
}

export interface HorizonBalance {
  balance: string;
  asset_type:
    | 'native'
    | 'credit_alphanum4'
    | 'credit_alphanum12'
    | 'liquidity_pool_shares';
  asset_code?: string;
  asset_issuer?: string;
}

export interface HorizonSigner {
  key: string;
  weight: number;
  type: string;
}

export interface HorizonAccount {
  id: string;
  account_id: string;
  sequence: string;
  subentry_count: number;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: HorizonSigner[];
  balances: HorizonBalance[];
}

export interface HorizonSubmitResult {
  hash: string;
  ledger: number;
  successful: boolean;
}
