import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, principalCV, bufferCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_AMOUNT = 101;
const ERR_INVALID_RECIPIENT = 102;
const ERR_INVALID_CONDITION = 103;
const ERR_ESCROW_ALREADY_EXISTS = 105;
const ERR_ESCROW_NOT_FOUND = 106;
const ERR_INVALID_PARAMS = 107;
const ERR_AUTHORITY_NOT_VERIFIED = 108;
const ERR_INVALID_FEE = 109;
const ERR_MAX_ESCROWS_EXCEEDED = 110;
const ERR_INVALID_CURRENCY = 112;
const ERR_INVALID_STATUS = 113;

interface Escrow {
  sender: string;
  recipient: string;
  amount: number;
  conditionContract: string;
  conditionParam: number;
  timestamp: number;
  currency: string;
  status: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class EscrowFactoryMock {
  state: {
    nextEscrowId: number;
    maxEscrows: number;
    creationFee: number;
    authorityContract: string | null;
    supportedCurrencies: string[];
    escrowsById: Map<number, Escrow>;
    escrowsBySender: Map<string, number[]>;
  } = {
    nextEscrowId: 1,
    maxEscrows: 10000,
    creationFee: 500,
    authorityContract: null,
    supportedCurrencies: ["STX", "USD", "BTC"],
    escrowsById: new Map(),
    escrowsBySender: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];
  escrowContract: EscrowContractMock;

  constructor() {
    this.escrowContract = new EscrowContractMock();
    this.reset();
  }

  reset(): void {
    this.state = {
      nextEscrowId: 1,
      maxEscrows: 10000,
      creationFee: 500,
      authorityContract: null,
      supportedCurrencies: ["STX", "USD", "BTC"],
      escrowsById: new Map(),
      escrowsBySender: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
    this.escrowContract.reset();
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setCreationFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) {
      return { ok: false, value: false };
    }
    if (newFee < 0) {
      return { ok: false, value: false };
    }
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }

  addCurrency(currency: string): Result<boolean> {
    if (!this.state.authorityContract) {
      return { ok: false, value: false };
    }
    if (this.state.supportedCurrencies.includes(currency)) {
      return { ok: true, value: true };
    }
    if (this.state.supportedCurrencies.length >= 10) {
      return { ok: false, value: false };
    }
    this.state.supportedCurrencies.push(currency);
    return { ok: true, value: true };
  }

  createEscrow(
    recipient: string,
    amount: number,
    conditionContract: string,
    conditionParams: Uint8Array,
    currency: string
  ): Result<number> {
    if (this.state.nextEscrowId >= this.state.maxEscrows) {
      return { ok: false, value: ERR_MAX_ESCROWS_EXCEEDED };
    }
    if (recipient === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: ERR_INVALID_RECIPIENT };
    }
    if (amount <= 0) {
      return { ok: false, value: ERR_INVALID_AMOUNT };
    }
    if (conditionContract === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: ERR_INVALID_CONDITION };
    }
    if (conditionParams.length === 0) {
      return { ok: false, value: ERR_INVALID_PARAMS };
    }
    if (!this.state.supportedCurrencies.includes(currency)) {
      return { ok: false, value: ERR_INVALID_CURRENCY };
    }
    if (!this.state.authorityContract) {
      return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    }
    if (this.state.escrowsById.has(this.state.nextEscrowId)) {
      return { ok: false, value: ERR_ESCROW_ALREADY_EXISTS };
    }

    this.stxTransfers.push({ amount: this.state.creationFee, from: this.caller, to: this.state.authorityContract });
    const conditionParam = this.escrowContract.createCondition(conditionParams).value;
    this.escrowContract.initEscrow(
      this.state.nextEscrowId,
      this.caller,
      recipient,
      amount,
      conditionContract,
      conditionParam,
      currency
    );

    const escrow: Escrow = {
      sender: this.caller,
      recipient,
      amount,
      conditionContract,
      conditionParam,
      timestamp: this.blockHeight,
      currency,
      status: true,
    };
    this.state.escrowsById.set(this.state.nextEscrowId, escrow);
    const senderEscrows = this.state.escrowsBySender.get(this.caller) || [];
    if (senderEscrows.length >= 100) {
      return { ok: false, value: ERR_MAX_ESCROWS_EXCEEDED };
    }
    senderEscrows.push(this.state.nextEscrowId);
    this.state.escrowsBySender.set(this.caller, senderEscrows);
    const id = this.state.nextEscrowId;
    this.state.nextEscrowId++;
    return { ok: true, value: id };
  }

  cancelEscrow(escrowId: number): Result<boolean> {
    const escrow = this.state.escrowsById.get(escrowId);
    if (!escrow) {
      return { ok: false, value: false };
    }
    if (escrow.sender !== this.caller) {
      return { ok: false, value: false };
    }
    if (!escrow.status) {
      return { ok: false, value: false };
    }
    this.escrowContract.refund(escrowId);
    this.state.escrowsById.set(escrowId, { ...escrow, status: false });
    return { ok: true, value: true };
  }

  getEscrow(id: number): Escrow | null {
    return this.state.escrowsById.get(id) || null;
  }

  getEscrowsBySender(sender: string): number[] {
    return this.state.escrowsBySender.get(sender) || [];
  }

  getEscrowCount(): Result<number> {
    return { ok: true, value: this.state.nextEscrowId };
  }

  getCreationFee(): Result<number> {
    return { ok: true, value: this.state.creationFee };
  }

  getSupportedCurrencies(): Result<string[]> {
    return { ok: true, value: this.state.supportedCurrencies };
  }
}

class EscrowContractMock {
  escrows: Map<number, { sender: string; recipient: string; amount: number; conditionContract: string; conditionParam: number; currency: string }> = new Map();

  reset(): void {
    this.escrows.clear();
  }

  createCondition(params: Uint8Array): Result<number> {
    return { ok: true, value: 1 };
  }

  initEscrow(id: number, sender: string, recipient: string, amount: number, conditionContract: string, conditionParam: number, currency: string): Result<number> {
    this.escrows.set(id, { sender, recipient, amount, conditionContract, conditionParam, currency });
    return { ok: true, value: id };
  }

  refund(id: number): Result<boolean> {
    if (!this.escrows.has(id)) {
      return { ok: false, value: false };
    }
    this.escrows.delete(id);
    return { ok: true, value: true };
  }
}

describe("EscrowFactory", () => {
  let contract: EscrowFactoryMock;

  beforeEach(() => {
    contract = new EscrowFactoryMock();
    contract.reset();
  });

  it("creates escrow successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const params = new Uint8Array([1, 2, 3]);
    const result = contract.createEscrow("ST3RECIPIENT", 1000, "ST4CONDITION", params, "STX");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);

    const escrow = contract.getEscrow(1);
    expect(escrow).toEqual({
      sender: "ST1TEST",
      recipient: "ST3RECIPIENT",
      amount: 1000,
      conditionContract: "ST4CONDITION",
      conditionParam: 1,
      timestamp: 0,
      currency: "STX",
      status: true,
    });
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1TEST", to: "ST2TEST" }]);
    expect(contract.getEscrowsBySender("ST1TEST")).toEqual([1]);
  });

  it("rejects escrow creation without authority contract", () => {
    const params = new Uint8Array([1, 2, 3]);
    const result = contract.createEscrow("ST3RECIPIENT", 1000, "ST4CONDITION", params, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid recipient", () => {
    contract.setAuthorityContract("ST2TEST");
    const params = new Uint8Array([1, 2, 3]);
    const result = contract.createEscrow("SP000000000000000000002Q6VF78", 1000, "ST4CONDITION", params, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RECIPIENT);
  });

  it("rejects invalid amount", () => {
    contract.setAuthorityContract("ST2TEST");
    const params = new Uint8Array([1, 2, 3]);
    const result = contract.createEscrow("ST3RECIPIENT", 0, "ST4CONDITION", params, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects invalid condition contract", () => {
    contract.setAuthorityContract("ST2TEST");
    const params = new Uint8Array([1, 2, 3]);
    const result = contract.createEscrow("ST3RECIPIENT", 1000, "SP000000000000000000002Q6VF78", params, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CONDITION);
  });

  it("rejects invalid parameters", () => {
    contract.setAuthorityContract("ST2TEST");
    const params = new Uint8Array([]);
    const result = contract.createEscrow("ST3RECIPIENT", 1000, "ST4CONDITION", params, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PARAMS);
  });

  it("rejects invalid currency", () => {
    contract.setAuthorityContract("ST2TEST");
    const params = new Uint8Array([1, 2, 3]);
    const result = contract.createEscrow("ST3RECIPIENT", 1000, "ST4CONDITION", params, "ETH");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CURRENCY);
  });

  it("cancels escrow successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const params = new Uint8Array([1, 2, 3]);
    contract.createEscrow("ST3RECIPIENT", 1000, "ST4CONDITION", params, "STX");
    const result = contract.cancelEscrow(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(1);
    expect(escrow?.status).toBe(false);
  });

  it("rejects cancel by non-sender", () => {
    contract.setAuthorityContract("ST2TEST");
    const params = new Uint8Array([1, 2, 3]);
    contract.createEscrow("ST3RECIPIENT", 1000, "ST4CONDITION", params, "STX");
    contract.caller = "ST5FAKE";
    const result = contract.cancelEscrow(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects cancel for non-existent escrow", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.cancelEscrow(999);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects cancel for already cancelled escrow", () => {
    contract.setAuthorityContract("ST2TEST");
    const params = new Uint8Array([1, 2, 3]);
    contract.createEscrow("ST3RECIPIENT", 1000, "ST4CONDITION", params, "STX");
    contract.cancelEscrow(1);
    const result = contract.cancelEscrow(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets creation fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setCreationFee(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.creationFee).toBe(1000);
  });

  it("rejects creation fee change without authority", () => {
    const result = contract.setCreationFee(1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("adds currency successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.addCurrency("ETH");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.supportedCurrencies).toContain("ETH");
  });

  it("rejects currency addition without authority", () => {
    const result = contract.addCurrency("ETH");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct escrow count", () => {
    contract.setAuthorityContract("ST2TEST");
    const params = new Uint8Array([1, 2, 3]);
    contract.createEscrow("ST3RECIPIENT", 1000, "ST4CONDITION", params, "STX");
    contract.createEscrow("ST3RECIPIENT", 2000, "ST4CONDITION", params, "USD");
    const result = contract.getEscrowCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(3);
  });
});