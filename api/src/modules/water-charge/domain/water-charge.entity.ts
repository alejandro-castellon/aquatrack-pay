import { toStroops } from '@/shared/stellar/stellar-amount';

export type WaterChargeStatus = 'pending' | 'paid' | 'cancelled';

export interface WaterChargeProps {
  id: string;
  apartmentMonthlyConsumptionId: string;
  apartmentId: string;
  buildingId: string;
  treasuryId: string;
  /** "YYYY-MM", the month of the consumption row it charges. */
  month: string;
  amountBs: number;
  /** Bs per 1 USDC, fixed when the charge was published. */
  exchangeRate: number;
  /** 7-decimal string, as Stellar expects it. */
  amountUsdc: string;
  /** Text memo the payment must carry; public on the ledger. */
  memo: string;
  /** Unguessable code of the public pay link. Never the memo. */
  publicCode: string;
  status: WaterChargeStatus;
  txHash: string | null;
  payerAddress: string | null;
  paidAmountUsdc: string | null;
  ledger: number | null;
  paidAt: Date | null;
  faucetDrips: number;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type NewWaterChargeProps = Pick<
  WaterChargeProps,
  | 'apartmentMonthlyConsumptionId'
  | 'apartmentId'
  | 'buildingId'
  | 'treasuryId'
  | 'month'
  | 'amountBs'
  | 'exchangeRate'
  | 'amountUsdc'
  | 'memo'
  | 'publicCode'
  | 'createdById'
>;

/**
 * What an apartment owes for a month, made payable on Stellar. The amount
 * owed lives in the consumption row (`payment`); what was actually received
 * is recorded here.
 */
export class WaterChargeEntity {
  private constructor(private readonly props: WaterChargeProps) {}

  static create(props: NewWaterChargeProps): WaterChargeEntity {
    return new WaterChargeEntity({
      ...props,
      id: crypto.randomUUID(),
      status: 'pending',
      txHash: null,
      payerAddress: null,
      paidAmountUsdc: null,
      ledger: null,
      paidAt: null,
      faucetDrips: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  static fromPersistence(props: WaterChargeProps): WaterChargeEntity {
    return new WaterChargeEntity(props);
  }

  get id(): string {
    return this.props.id;
  }

  get apartmentMonthlyConsumptionId(): string {
    return this.props.apartmentMonthlyConsumptionId;
  }

  get apartmentId(): string {
    return this.props.apartmentId;
  }

  get buildingId(): string {
    return this.props.buildingId;
  }

  get treasuryId(): string {
    return this.props.treasuryId;
  }

  get month(): string {
    return this.props.month;
  }

  get amountBs(): number {
    return this.props.amountBs;
  }

  get exchangeRate(): number {
    return this.props.exchangeRate;
  }

  get amountUsdc(): string {
    return this.props.amountUsdc;
  }

  get memo(): string {
    return this.props.memo;
  }

  get publicCode(): string {
    return this.props.publicCode;
  }

  get status(): WaterChargeStatus {
    return this.props.status;
  }

  get txHash(): string | null {
    return this.props.txHash;
  }

  get payerAddress(): string | null {
    return this.props.payerAddress;
  }

  get paidAmountUsdc(): string | null {
    return this.props.paidAmountUsdc;
  }

  get ledger(): number | null {
    return this.props.ledger;
  }

  get paidAt(): Date | null {
    return this.props.paidAt;
  }

  get faucetDrips(): number {
    return this.props.faucetDrips;
  }

  get createdById(): string | null {
    return this.props.createdById;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isPending(): boolean {
    return this.props.status === 'pending';
  }

  get isPaid(): boolean {
    return this.props.status === 'paid';
  }

  /** The amount due as an integer, to compare without floats. */
  get dueStroops(): bigint {
    return toStroops(this.props.amountUsdc);
  }

  toPlainObject(): WaterChargeProps {
    return { ...this.props };
  }
}

/**
 * A charge with what the API shows next to it. Read side only: it is what
 * the repository returns for listings and for the public pay page.
 */
export interface WaterChargeView {
  charge: WaterChargeEntity;
  apartmentNumber: string;
  apartmentFloor: number;
  /** m³ of the monthly consumption row. */
  consumption: number;
  periodStartDate: Date | null;
  periodEndDate: Date | null;
  buildingName: string;
  treasury: {
    publicKey: string;
    network: string;
    assetCode: string;
    assetIssuer: string;
  };
}
