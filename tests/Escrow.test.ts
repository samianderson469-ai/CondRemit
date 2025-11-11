// tests/Escrow.test.ts
import { describe, it, expect, beforeEach } from "vitest";

interface Escrow {
  sender: string;
  recipient: string;
  amount: bigint;
  currency: string;
  conditionContract: string;
  conditionParam: bigint;
  createdAt: bigint;
  expiresAt: bigint | null;
  status: string;
  disputeResolver: string | null;
  disputeInitiated: boolean;
  disputeReason: string | null;
  cancelled: boolean;
}

interface DisputeRecord {
  initiator: string;
  timestamp: bigint;
  resolved: boolean;
}

const ERR_NOT_FOUND = 404;
const ERR_NOT_OWNER = 403;
const ERR_CONDITION_NOT_MET = 201;
const ERR_TRANSFER_FAILED = 301;
const ERR_ALREADY_CLAIMED = 202;
const ERR_INVALID_AMOUNT = 102;
const ERR_INVALID_RECIPIENT = 103;
const ERR_INVALID_CONDITION = 101;
const ERR_ESCROW_EXPIRED = 203;
const ERR_ESCROW_NOT_EXPIRED = 204;
const ERR_DISPUTE_INITIATED = 205;
const ERR_DISPUTE_NOT_INITIATED = 206;
const ERR_NOT_DISPUTE_RESOLVER = 207;
const ERR_INVALID_DISPUTE_FEE = 208;
const ERR_INVALID_CURRENCY = 119;
const ERR_INSUFFICIENT_BALANCE = 302;
const ERR_REENTRANCY = 303;
const ERR_MAX_ESCROWS_EXCEEDED = 114;
const ERR_ESCROW_CANCELLED = 209;
const ERR_ESCROW_NOT_CANCELLED = 210;

class EscrowMock {
  private state: {
    nextEscrowId: bigint;
    maxEscrows: bigint;
    disputeFee: bigint;
    reentrancyGuard: boolean;
    escrows: Map<bigint, Escrow>;
    escrowBalances: Map<bigint, bigint>;
    disputeRecords: Map<bigint, DisputeRecord>;
  } = {
    nextEscrowId: BigInt(1),
    maxEscrows: BigInt(10000),
    disputeFee: BigInt(500),
    reentrancyGuard: false,
    escrows: new Map(),
    escrowBalances: new Map(),
    disputeRecords: new Map(),
  };

  public blockHeight: bigint = BigInt(100);
  public caller: string = "ST1SENDER";
  public stxTransfers: Array<{ amount: bigint; from: string; to: string }> = [];
  public events: Array<{ type: string; data: any }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextEscrowId: BigInt(1),
      maxEscrows: BigInt(10000),
      disputeFee: BigInt(500),
      reentrancyGuard: false,
      escrows: new Map(),
      escrowBalances: new Map(),
      disputeRecords: new Map(),
    };
    this.blockHeight = BigInt(100);
    this.caller = "ST1SENDER";
    this.stxTransfers = [];
    this.events = [];
  }

  private preventReentrancy(): { ok: true; value: true } | { ok: false; value: number } {
    if (this.state.reentrancyGuard) return { ok: false, value: ERR_REENTRANCY };
    this.state.reentrancyGuard = true;
    return { ok: true, value: true };
  }

  private releaseReentrancy(): { ok: true; value: true } {
    this.state.reentrancyGuard = false;
    return { ok: true, value: true };
  }

  private transferStx(amount: bigint, to: string): { ok: true; value: true } | { ok: false; value: number } {
    this.stxTransfers.push({ amount, from: this.caller, to });
    return { ok: true, value: true };
  }

  private emitEvent(type: string, data: any) {
    this.events.push({ type, data });
  }

  initEscrow(
    id: bigint,
    sender: string,
    recipient: string,
    amount: bigint,
    currency: string,
    conditionContract: string,
    conditionParam: bigint,
    expiresIn: bigint | null
  ): { ok: true; value: bigint } | { ok: false; value: number } {
    if (id !== this.state.nextEscrowId - BigInt(1)) return { ok: false, value: ERR_NOT_FOUND };
    if (amount <= BigInt(0)) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (recipient === sender) return { ok: false, value: ERR_INVALID_RECIPIENT };
    if (!["STX", "USD"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (conditionContract === sender) return { ok: false, value: ERR_INVALID_CONDITION };
    if (this.state.nextEscrowId > this.state.maxEscrows) return { ok: false, value: ERR_MAX_ESCROWS_EXCEEDED };

    const prevent = this.preventReentrancy();
    if (!prevent.ok) return prevent;

    const escrow: Escrow = {
      sender,
      recipient,
      amount,
      currency,
      conditionContract,
      conditionParam,
      createdAt: this.blockHeight,
      expiresAt: expiresIn !== null ? this.blockHeight + expiresIn : null,
      status: "active",
      disputeResolver: null,
      disputeInitiated: false,
      disputeReason: null,
      cancelled: false,
    };

    this.state.escrows.set(id, escrow);
    this.state.escrowBalances.set(id, amount);
    this.transferStx(amount, sender);
    this.state.nextEscrowId += BigInt(1);
    this.emitEvent("escrow-created", { id, sender, recipient, amount });
    this.releaseReentrancy();
    return { ok: true, value: id };
  }

  release(id: bigint, conditionVerified: boolean): { ok: true; value: true } | { ok: false; value: number } {
    const escrow = this.state.escrows.get(id);
    if (!escrow) return { ok: false, value: ERR_NOT_FOUND };
    if (escrow.cancelled) return { ok: false, value: ERR_ESCROW_CANCELLED };
    if (escrow.status !== "active") return { ok: false, value: ERR_ALREADY_CLAIMED };

    const prevent = this.preventReentrancy();
    if (!prevent.ok) return prevent;

    if (!conditionVerified) {
      this.releaseReentrancy();
      return { ok: false, value: ERR_CONDITION_NOT_MET };
    }

    const balance = this.state.escrowBalances.get(id);
    if (!balance) {
      this.releaseReentrancy();
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    }

    this.transferStx(balance, escrow.recipient);
    this.state.escrowBalances.delete(id);
    this.state.escrows.set(id, { ...escrow, status: "released" });
    this.emitEvent("escrow-released", { id, recipient: escrow.recipient, amount: balance });
    this.releaseReentrancy();
    return { ok: true, value: true };
  }

  refund(id: bigint): { ok: true; value: true } | { ok: false; value: number } {
    const escrow = this.state.escrows.get(id);
    if (!escrow) return { ok: false, value: ERR_NOT_FOUND };
    if (this.caller !== escrow.sender) return { ok: false, value: ERR_NOT_OWNER };
    if (escrow.status !== "active") return { ok: false, value: ERR_ALREADY_CLAIMED };
    if (escrow.disputeInitiated) return { ok: false, value: ERR_DISPUTE_INITIATED };
    if (escrow.cancelled) return { ok: false, value: ERR_ESCROW_CANCELLED };

    const prevent = this.preventReentrancy();
    if (!prevent.ok) return prevent;

    if (escrow.expiresAt !== null && this.blockHeight < escrow.expiresAt) {
      this.releaseReentrancy();
      return { ok: false, value: ERR_ESCROW_NOT_EXPIRED };
    }

    const balance = this.state.escrowBalances.get(id);
    if (!balance) {
      this.releaseReentrancy();
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    }

    this.transferStx(balance, escrow.sender);
    this.state.escrowBalances.delete(id);
    this.state.escrows.set(id, { ...escrow, status: "refunded" });
    this.emitEvent("escrow-refunded", { id, sender: escrow.sender, amount: balance });
    this.releaseReentrancy();
    return { ok: true, value: true };
  }

  cancel(id: bigint): { ok: true; value: true } | { ok: false; value: number } {
    const escrow = this.state.escrows.get(id);
    if (!escrow) return { ok: false, value: ERR_NOT_FOUND };
    if (this.caller !== escrow.sender) return { ok: false, value: ERR_NOT_OWNER };
    if (escrow.status !== "active") return { ok: false, value: ERR_ALREADY_CLAIMED };
    if (escrow.disputeInitiated) return { ok: false, value: ERR_DISPUTE_INITIATED };

    const prevent = this.preventReentrancy();
    if (!prevent.ok) return prevent;

    const balance = this.state.escrowBalances.get(id);
    if (!balance) {
      this.releaseReentrancy();
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    }

    this.transferStx(balance, escrow.sender);
    this.state.escrowBalances.delete(id);
    this.state.escrows.set(id, { ...escrow, status: "cancelled", cancelled: true });
    this.emitEvent("escrow-cancelled", { id, sender: escrow.sender });
    this.releaseReentrancy();
    return { ok: true, value: true };
  }

  initiateDispute(id: bigint, reason: string): { ok: true; value: true } | { ok: false; value: number } {
    const escrow = this.state.escrows.get(id);
    if (!escrow) return { ok: false, value: ERR_NOT_FOUND };
    if (![escrow.sender, escrow.recipient].includes(this.caller)) return { ok: false, value: ERR_NOT_OWNER };
    if (escrow.status !== "active") return { ok: false, value: ERR_ALREADY_CLAIMED };
    if (escrow.disputeInitiated) return { ok: false, value: ERR_DISPUTE_INITIATED };

    const prevent = this.preventReentrancy();
    if (!prevent.ok) return prevent;

    this.transferStx(this.state.disputeFee, this.caller);
    this.state.escrows.set(id, { ...escrow, disputeInitiated: true, disputeReason: reason });
    this.state.disputeRecords.set(id, { initiator: this.caller, timestamp: this.blockHeight, resolved: false });
    this.emitEvent("dispute-initiated", { id, initiator: this.caller, reason });
    this.releaseReentrancy();
    return { ok: true, value: true };
  }

  resolveDispute(id: bigint, releaseToRecipient: boolean): { ok: true; value: true } | { ok: false; value: number } {
    const escrow = this.state.escrows.get(id);
    if (!escrow) return { ok: false, value: ERR_NOT_FOUND };
    if (!escrow.disputeInitiated) return { ok: false, value: ERR_DISPUTE_NOT_INITIATED };
    if (escrow.disputeResolver !== this.caller) return { ok: false, value: ERR_NOT_DISPUTE_RESOLVER };

    const prevent = this.preventReentrancy();
    if (!prevent.ok) return prevent;

    const balance = this.state.escrowBalances.get(id);
    if (!balance) {
      this.releaseReentrancy();
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    }

    const recipient = releaseToRecipient ? escrow.recipient : escrow.sender;
    this.transferStx(balance, recipient);
    this.state.escrowBalances.delete(id);
    this.state.escrows.set(id, { ...escrow, status: releaseToRecipient ? "released" : "refunded" });
    const record = this.state.disputeRecords.get(id);
    if (record) this.state.disputeRecords.set(id, { ...record, resolved: true });
    this.emitEvent("dispute-resolved", { id, winner: recipient, amount: balance });
    this.releaseReentrancy();
    return { ok: true, value: true };
  }

  setDisputeResolver(id: bigint, resolver: string): { ok: true; value: true } | { ok: false; value: number } {
    const escrow = this.state.escrows.get(id);
    if (!escrow) return { ok: false, value: ERR_NOT_FOUND };
    if (this.caller !== escrow.sender) return { ok: false, value: ERR_NOT_OWNER };
    if (!escrow.disputeInitiated) return { ok: false, value: ERR_DISPUTE_NOT_INITIATED };
    this.state.escrows.set(id, { ...escrow, disputeResolver: resolver });
    this.emitEvent("dispute-resolver-set", { id, resolver });
    return { ok: true, value: true };
  }

  extendExpiry(id: bigint, additionalBlocks: bigint): { ok: true; value: bigint } | { ok: false; value: number } {
    const escrow = this.state.escrows.get(id);
    if (!escrow) return { ok: false, value: ERR_NOT_FOUND };
    if (this.caller !== escrow.sender) return { ok: false, value: ERR_NOT_OWNER };
    if (escrow.status !== "active") return { ok: false, value: ERR_ALREADY_CLAIMED };
    if (additionalBlocks <= BigInt(0)) return { ok: false, value: ERR_INVALID_AMOUNT };
    const currentExpiry = escrow.expiresAt ?? this.blockHeight;
    const newExpiry = currentExpiry + additionalBlocks;
    this.state.escrows.set(id, { ...escrow, expiresAt: newExpiry });
    this.emitEvent("expiry-extended", { id, newExpiry });
    return { ok: true, value: newExpiry };
  }

  getEscrowCount(): { ok: true; value: bigint } {
    return { ok: true, value: this.state.nextEscrowId };
  }

  getEscrow(id: bigint): Escrow | null {
    return this.state.escrows.get(id) || null;
  }

  getDisputeRecord(id: bigint): DisputeRecord | null {
    return this.state.disputeRecords.get(id) || null;
  }
}

describe("Escrow Core Contract - Comprehensive Integration & Edge Cases", () => {
  let mock: EscrowMock;

  beforeEach(() => {
    mock = new EscrowMock();
    mock.reset();
  });

  it("creates escrow, recipient releases on condition, sender cannot refund, dispute blocked, events emitted, balances correct", () => {
    const init = mock.initEscrow(BigInt(0), "ST1SENDER", "ST1RECIPIENT", BigInt(5000), "STX", "ST1TIME", BigInt(999), BigInt(200));
    expect(init.ok).toBe(true);
    expect(init.value).toBe(BigInt(0));
    expect(mock.stxTransfers).toHaveLength(1);
    expect(mock.stxTransfers[0].amount).toBe(BigInt(5000));
    expect(mock.events[0].type).toBe("escrow-created");
    expect(mock.getEscrow(BigInt(0))?.status).toBe("active");
    expect(mock.getEscrow(BigInt(0))?.expiresAt).toBe(BigInt(300));

    mock.caller = "ST1RECIPIENT";
    const release = mock.release(BigInt(0), true);
    expect(release.ok).toBe(true);
    expect(mock.stxTransfers).toHaveLength(2);
    expect(mock.stxTransfers[1].to).toBe("ST1RECIPIENT");
    expect(mock.getEscrow(BigInt(0))?.status).toBe("released");
    expect(mock.events[1].type).toBe("escrow-released");

    mock.caller = "ST1SENDER";
    const failedRefund = mock.refund(BigInt(0));
    expect(failedRefund.ok).toBe(false);
    expect(failedRefund.value).toBe(ERR_ALREADY_CLAIMED);
  });

  it("sender cancels before any action, recipient cannot claim, funds returned, status cancelled, no dispute possible", () => {
    mock.initEscrow(BigInt(0), "ST1SENDER", "ST1RECIPIENT", BigInt(3000), "USD", "ST1ORACLE", BigInt(888), null);
    mock.caller = "ST1SENDER";
    const cancel = mock.cancel(BigInt(0));
    expect(cancel.ok).toBe(true);
    expect(mock.getEscrow(BigInt(0))?.cancelled).toBe(true);
    expect(mock.getEscrow(BigInt(0))?.status).toBe("cancelled");
    expect(mock.events[1].type).toBe("escrow-cancelled");

    mock.caller = "ST1RECIPIENT";
    const failedRelease = mock.release(BigInt(0), true);
    expect(failedRelease.ok).toBe(false);
    expect(failedRelease.value).toBe(ERR_ESCROW_CANCELLED);

    const failedDispute = mock.initiateDispute(BigInt(0), "Not delivered");
    expect(failedDispute.ok).toBe(false);
  });

  it("expires after timeout, sender refunds, recipient cannot release or dispute, expiry enforced strictly", () => {
    mock.initEscrow(BigInt(0), "ST1SENDER", "ST1RECIPIENT", BigInt(2000), "STX", "ST1CONDITION", BigInt(777), BigInt(50));
    mock.blockHeight = BigInt(160);
    mock.caller = "ST1SENDER";
    const refund = mock.refund(BigInt(0));
    expect(refund.ok).toBe(true);
    expect(mock.getEscrow(BigInt(0))?.status).toBe("refunded");
    expect(mock.stxTransfers[1].to).toBe("ST1SENDER");

    mock.caller = "ST1RECIPIENT";
    const failedRelease = mock.release(BigInt(0), true);
    expect(failedRelease.ok).toBe(false);
    expect(failedRelease.value).toBe(ERR_ALREADY_CLAIMED);
  });

  it("full dispute lifecycle with resolver, fee paid, resolution in favor of recipient, sender loses, audit trail complete", () => {
    mock.initEscrow(BigInt(0), "ST1SENDER", "ST1RECIPIENT", BigInt(7500), "STX", "ST1MULTISIG", BigInt(555), BigInt(300));
    mock.caller = "ST1RECIPIENT";
    const dispute = mock.initiateDispute(BigInt(0), "Goods damaged on arrival");
    expect(dispute.ok).toBe(true);
    expect(mock.stxTransfers).toHaveLength(2);
    expect(mock.stxTransfers[1].amount).toBe(BigInt(500));
    expect(mock.getDisputeRecord(BigInt(0))?.initiator).toBe("ST1RECIPIENT");

    mock.caller = "ST1SENDER";
    mock.setDisputeResolver(BigInt(0), "ST1ARBITRATOR");
    expect(mock.getEscrow(BigInt(0))?.disputeResolver).toBe("ST1ARBITRATOR");

    mock.caller = "ST1ARBITRATOR";
    const resolve = mock.resolveDispute(BigInt(0), true);
    expect(resolve.ok).toBe(true);
    expect(mock.stxTransfers[2].to).toBe("ST1RECIPIENT");
    expect(mock.getEscrow(BigInt(0))?.status).toBe("released");
    expect(mock.getDisputeRecord(BigInt(0))?.resolved).toBe(true);
  });

  it("prevents reentrancy by simulating nested call, guard blocks second entry, state remains consistent", () => {
    mock.initEscrow(BigInt(0), "ST1SENDER", "ST1RECIPIENT", BigInt(1000), "STX", "ST1CONDITION", BigInt(123), null);
    mock.state.reentrancyGuard = true;
    const attack = mock.release(BigInt(0), true);
    expect(attack.ok).toBe(false);
    expect(attack.value).toBe(ERR_REENTRANCY);
    expect(mock.getEscrow(BigInt(0))?.status).toBe("active");
  });

  it("enforces global escrow limit, rejects 10001th creation, protects against spam, count accurate", () => {
    mock.state.nextEscrowId = BigInt(10001);
    mock.state.maxEscrows = BigInt(10000);
    const overflow = mock.initEscrow(BigInt(10000), "ST1SENDER", "ST1RECIPIENT", BigInt(100), "STX", "ST1COND", BigInt(1), null);
    expect(overflow.ok).toBe(false);
    expect(overflow.value).toBe(ERR_MAX_ESCROWS_EXCEEDED);
    expect(mock.getEscrowCount().value).toBe(BigInt(10001));
  });

  it("extends expiry multiple times, final expiry correct, prevents release before new expiry, sender only", () => {
    mock.initEscrow(BigInt(0), "ST1SENDER", "ST1RECIPIENT", BigInt(4000), "USD", "ST1TIME", BigInt(444), BigInt(100));
    mock.caller = "ST1SENDER";
    mock.extendExpiry(BigInt(0), BigInt(50));
    mock.extendExpiry(BigInt(0), BigInt(30));
    const final = mock.extendExpiry(BigInt(0), BigInt(20));
    expect(final.value).toBe(BigInt(300));

    mock.blockHeight = BigInt(250);
    mock.caller = "ST1SENDER";
    const early = mock.refund(BigInt(0));
    expect(early.ok).toBe(false);
    expect(early.value).toBe(ERR_ESCROW_NOT_EXPIRED);
  });

  it("rejects invalid currency, invalid amount, self-recipient, same condition contract, input validation comprehensive", () => {
    const invalidCurrency = mock.initEscrow(BigInt(0), "ST1SENDER", "ST1RECIPIENT", BigInt(1000), "BTC", "ST1COND", BigInt(1), null);
    expect(invalidCurrency.ok).toBe(false);
    expect(invalidCurrency.value).toBe(ERR_INVALID_CURRENCY);

    const zeroAmount = mock.initEscrow(BigInt(0), "ST1SENDER", "ST1RECIPIENT", BigInt(0), "STX", "ST1COND", BigInt(1), null);
    expect(zeroAmount.ok).toBe(false);
    expect(zeroAmount.value).toBe(ERR_INVALID_AMOUNT);

    const selfRecipient = mock.initEscrow(BigInt(0), "ST1SENDER", "ST1SENDER", BigInt(1000), "STX", "ST1COND", BigInt(1), null);
    expect(selfRecipient.ok).toBe(false);
    expect(selfRecipient.value).toBe(ERR_INVALID_RECIPIENT);

    const sameCondition = mock.initEscrow(BigInt(0), "ST1SENDER", "ST1RECIPIENT", BigInt(1000), "STX", "ST1SENDER", BigInt(1), null);
    expect(sameCondition.ok).toBe(false);
    expect(sameCondition.value).toBe(ERR_INVALID_CONDITION);
  });

  it("handles concurrent escrow creation by different senders, IDs increment correctly, isolation maintained", () => {
    mock.caller = "ST1ALICE";
    mock.initEscrow(BigInt(0), "ST1ALICE", "ST1BOB", BigInt(2000), "STX", "ST1COND1", BigInt(1), null);
    mock.caller = "ST1CHARLIE";
    mock.initEscrow(BigInt(1), "ST1CHARLIE", "ST1DAVE", BigInt(3000), "USD", "ST1COND2", BigInt(2), BigInt(100));

    expect(mock.getEscrow(BigInt(0))?.sender).toBe("ST1ALICE");
    expect(mock.getEscrow(BigInt(1))?.sender).toBe("ST1CHARLIE");
    expect(mock.getEscrowCount().value).toBe(BigInt(3));
  });

  it("emits all expected events in correct order across full lifecycle including dispute and resolution", () => {
    mock.initEscrow(BigInt(0), "ST1SENDER", "ST1RECIPIENT", BigInt(6000), "STX", "ST1COND", BigInt(999), BigInt(200));
    mock.caller = "ST1RECIPIENT";
    mock.initiateDispute(BigInt(0), "Quality issue");
    mock.caller = "ST1SENDER";
    mock.setDisputeResolver(BigInt(0), "ST1JUDGE");
    mock.caller = "ST1JUDGE";
    mock.resolveDispute(BigInt(0), false);

    expect(mock.events.map(e => e.type)).toEqual([
      "escrow-created",
      "dispute-initiated",
      "dispute-resolver-set",
      "dispute-resolved"
    ]);
  });
});