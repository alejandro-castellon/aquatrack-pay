/** A person who can sign for the treasury, as the admin labelled them. */
export interface TreasurySigner {
  publicKey: string;
  label: string;
}

export interface BuildingTreasuryProps {
  id: string;
  buildingId: string;
  /** "testnet" or "public". */
  network: string;
  /** Stellar account id (G...). */
  publicKey: string;
  assetCode: string;
  assetIssuer: string;
  /** Snapshot taken at setup; the chain is the source of truth. */
  signers: TreasurySigner[];
  /** Signatures needed to move funds. */
  threshold: number;
  setupTxHash: string;
  /** Horizon paging token of the last record the watcher processed. */
  lastCursor: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The Stellar account that receives a building's water charges ("caja").
 * AquaTrack never holds its keys: only the board's signers can move funds.
 */
export class BuildingTreasuryEntity {
  private constructor(private readonly props: BuildingTreasuryProps) {}

  static create(
    props: Omit<
      BuildingTreasuryProps,
      'id' | 'lastCursor' | 'createdAt' | 'updatedAt'
    >,
  ): BuildingTreasuryEntity {
    return new BuildingTreasuryEntity({
      ...props,
      signers: props.signers.map((signer) => ({ ...signer })),
      id: crypto.randomUUID(),
      lastCursor: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  static fromPersistence(props: BuildingTreasuryProps): BuildingTreasuryEntity {
    return new BuildingTreasuryEntity(props);
  }

  get id(): string {
    return this.props.id;
  }

  get buildingId(): string {
    return this.props.buildingId;
  }

  get network(): string {
    return this.props.network;
  }

  get publicKey(): string {
    return this.props.publicKey;
  }

  get assetCode(): string {
    return this.props.assetCode;
  }

  get assetIssuer(): string {
    return this.props.assetIssuer;
  }

  get signers(): TreasurySigner[] {
    return this.props.signers.map((signer) => ({ ...signer }));
  }

  get threshold(): number {
    return this.props.threshold;
  }

  get setupTxHash(): string {
    return this.props.setupTxHash;
  }

  get lastCursor(): string | null {
    return this.props.lastCursor;
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

  toPlainObject(): BuildingTreasuryProps {
    return { ...this.props, signers: this.signers };
  }
}
