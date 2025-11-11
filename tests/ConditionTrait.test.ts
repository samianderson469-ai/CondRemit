import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_MAX_SIGNERS = 101;
const ERR_INVALID_REQUIRED = 102;
const ERR_INVALID_VOTING_DUR = 103;
const ERR_INVALID_PENALTY_RATE = 104;
const ERR_INVALID_THRESHOLD = 105;
const ERR_CONDITION_ALREADY_EXISTS = 106;
const ERR_CONDITION_NOT_FOUND = 107;
const ERR_INVALID_CONDITION_TYPE = 115;
const ERR_INVALID_INTEREST_RATE = 116;
const ERR_INVALID_GRACE_PERIOD = 117;
const ERR_INVALID_LOCATION = 118;
const ERR_INVALID_CURRENCY = 119;
const ERR_INVALID_MIN_STAKE = 110;
const ERR_INVALID_MAX_STAKE = 111;
const ERR_MAX_CONDITIONS_EXCEEDED = 114;
const ERR_INVALID_UPDATE_PARAM = 113;
const ERR_AUTHORITY_NOT_VERIFIED = 109;
const ERR_ALREADY_SIGNED = 121;
const ERR_NOT_SIGNER = 122;

interface Condition {
  name: string;
  maxSigners: number;
  required: number;
  votingDuration: number;
  penaltyRate: number;
  threshold: number;
  timestamp: number;
  creator: string;
  conditionType: string;
  interestRate: number;
  gracePeriod: number;
  location: string;
  currency: string;
  status: boolean;
  minStake: number;
  maxStake: number;
  signers: string[];
  approvals: string[];
}

interface ConditionUpdate {
  updateName: string;
  updateMaxSigners: number;
  updateRequired: number;
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class MultiSigConditionMock {
  state: {
    nextConditionId: number;
    maxConditions: number;
    creationFee: number;
    authorityContract: string | null;
    conditions: Map<number, Condition>;
    conditionUpdates: Map<number, ConditionUpdate>;
    conditionsByName: Map<string, number>;
  } = {
    nextConditionId: 0,
    maxConditions: 1000,
    creationFee: 1000,
    authorityContract: null,
    conditions: new Map(),
    conditionUpdates: new Map(),
    conditionsByName: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextConditionId: 0,
      maxConditions: 1000,
      creationFee: 1000,
      authorityContract: null,
      conditions: new Map(),
      conditionUpdates: new Map(),
      conditionsByName: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }

  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
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
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }

  createCondition(
    name: string,
    maxSigners: number,
    required: number,
    votingDuration: number,
    penaltyRate: number,
    threshold: number,
    conditionType: string,
    interestRate: number,
    gracePeriod: number,
    location: string,
    currency: string,
    minStake: number,
    maxStake: number,
    signers: string[]
  ): Result<number> {
    if (this.state.nextConditionId >= this.state.maxConditions) return { ok: false, value: ERR_MAX_CONDITIONS_EXCEEDED };
    if (!name || name.length > 100) return { ok: false, value: ERR_INVALID_UPDATE_PARAM };
    if (maxSigners <= 0 || maxSigners > 50) return { ok: false, value: ERR_INVALID_MAX_SIGNERS };
    if (required <= 0) return { ok: false, value: ERR_INVALID_REQUIRED };
    if (votingDuration <= 0) return { ok: false, value: ERR_INVALID_VOTING_DUR };
    if (penaltyRate > 100) return { ok: false, value: ERR_INVALID_PENALTY_RATE };
    if (threshold <= 0 || threshold > 100) return { ok: false, value: ERR_INVALID_THRESHOLD };
    if (!["simple", "weighted", "community"].includes(conditionType)) return { ok: false, value: ERR_INVALID_CONDITION_TYPE };
    if (interestRate > 20) return { ok: false, value: ERR_INVALID_INTEREST_RATE };
    if (gracePeriod > 30) return { ok: false, value: ERR_INVALID_GRACE_PERIOD };
    if (!location || location.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!["STX", "USD", "BTC"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (minStake <= 0) return { ok: false, value: ERR_INVALID_MIN_STAKE };
    if (maxStake <= 0) return { ok: false, value: ERR_INVALID_MAX_STAKE };
    if (required > maxSigners) return { ok: false, value: ERR_INVALID_REQUIRED };
    if (!this.isVerifiedAuthority(this.caller).value) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.conditionsByName.has(name)) return { ok: false, value: ERR_CONDITION_ALREADY_EXISTS };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.creationFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextConditionId;
    const condition: Condition = {
      name,
      maxSigners,
      required,
      votingDuration,
      penaltyRate,
      threshold,
      timestamp: this.blockHeight,
      creator: this.caller,
      conditionType,
      interestRate,
      gracePeriod,
      location,
      currency,
      status: true,
      minStake,
      maxStake,
      signers,
      approvals: [],
    };
    this.state.conditions.set(id, condition);
    this.state.conditionsByName.set(name, id);
    this.state.nextConditionId++;
    return { ok: true, value: id };
  }

  approve(id: number): Result<boolean> {
    const condition = this.state.conditions.get(id);
    if (!condition) return { ok: false, value: false };
    if (!condition.signers.includes(this.caller)) return { ok: false, value: ERR_NOT_SIGNER };
    if (condition.approvals.includes(this.caller)) return { ok: false, value: ERR_ALREADY_SIGNED };
    condition.approvals.push(this.caller);
    this.state.conditions.set(id, condition);
    return { ok: true, value: true };
  }

  verify(recipient: string, id: number): Result<boolean> {
    const condition = this.state.conditions.get(id);
    if (!condition) return { ok: false, value: false };
    const met = condition.approvals.length >= condition.required;
    const inTime = this.blockHeight <= condition.timestamp + condition.votingDuration;
    return { ok: true, value: met && inTime };
  }

  getCondition(id: number): Condition | null {
    return this.state.conditions.get(id) || null;
  }

  updateCondition(id: number, updateName: string, updateMaxSigners: number, updateRequired: number): Result<boolean> {
    const condition = this.state.conditions.get(id);
    if (!condition) return { ok: false, value: false };
    if (condition.creator !== this.caller) return { ok: false, value: false };
    if (!updateName || updateName.length > 100) return { ok: false, value: false };
    if (updateMaxSigners <= 0 || updateMaxSigners > 50) return { ok: false, value: false };
    if (updateRequired <= 0) return { ok: false, value: false };
    if (updateRequired > updateMaxSigners) return { ok: false, value: false };
    if (this.state.conditionsByName.has(updateName) && this.state.conditionsByName.get(updateName) !== id) {
      return { ok: false, value: false };
    }

    const updated: Condition = {
      ...condition,
      name: updateName,
      maxSigners: updateMaxSigners,
      required: updateRequired,
      timestamp: this.blockHeight,
    };
    this.state.conditions.set(id, updated);
    this.state.conditionsByName.delete(condition.name);
    this.state.conditionsByName.set(updateName, id);
    this.state.conditionUpdates.set(id, {
      updateName,
      updateMaxSigners,
      updateRequired,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  getConditionCount(): Result<number> {
    return { ok: true, value: this.state.nextConditionId };
  }

  checkConditionExistence(name: string): Result<boolean> {
    return { ok: true, value: this.state.conditionsByName.has(name) };
  }
}

describe("MultiSigCondition", () => {
  let contract: MultiSigConditionMock;

  beforeEach(() => {
    contract = new MultiSigConditionMock();
    contract.reset();
  });

  it("creates a condition successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createCondition(
      "Alpha",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1", "ST4SIGNER2"]
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const condition = contract.getCondition(0);
    expect(condition?.name).toBe("Alpha");
    expect(condition?.maxSigners).toBe(10);
    expect(condition?.required).toBe(5);
    expect(condition?.votingDuration).toBe(30);
    expect(condition?.penaltyRate).toBe(5);
    expect(condition?.threshold).toBe(50);
    expect(condition?.conditionType).toBe("simple");
    expect(condition?.interestRate).toBe(10);
    expect(condition?.gracePeriod).toBe(7);
    expect(condition?.location).toBe("VillageX");
    expect(condition?.currency).toBe("STX");
    expect(condition?.minStake).toBe(50);
    expect(condition?.maxStake).toBe(1000);
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects duplicate condition names", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createCondition(
      "Alpha",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    const result = contract.createCondition(
      "Alpha",
      20,
      10,
      60,
      10,
      60,
      "weighted",
      15,
      14,
      "CityY",
      "USD",
      100,
      2000,
      ["ST4SIGNER2"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CONDITION_ALREADY_EXISTS);
  });

  it("rejects non-authorized caller", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.caller = "ST2FAKE";
    contract.authorities = new Set();
    const result = contract.createCondition(
      "Beta",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("parses condition name with Clarity", () => {
    const cv = stringUtf8CV("Gamma");
    expect(cv.value).toBe("Gamma");
  });

  it("rejects condition creation without authority contract", () => {
    const result = contract.createCondition(
      "NoAuth",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid max signers", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createCondition(
      "InvalidMembers",
      51,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MAX_SIGNERS);
  });

  it("rejects invalid required", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createCondition(
      "InvalidRequired",
      10,
      0,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_REQUIRED);
  });

  it("rejects invalid condition type", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createCondition(
      "InvalidType",
      10,
      5,
      30,
      5,
      50,
      "invalid",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CONDITION_TYPE);
  });

  it("updates a condition successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createCondition(
      "OldCondition",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    const result = contract.updateCondition(0, "NewCondition", 15, 8);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const condition = contract.getCondition(0);
    expect(condition?.name).toBe("NewCondition");
    expect(condition?.maxSigners).toBe(15);
    expect(condition?.required).toBe(8);
    const update = contract.state.conditionUpdates.get(0);
    expect(update?.updateName).toBe("NewCondition");
    expect(update?.updateMaxSigners).toBe(15);
    expect(update?.updateRequired).toBe(8);
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent condition", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateCondition(99, "NewCondition", 15, 8);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects update by non-creator", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createCondition(
      "TestCondition",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    contract.caller = "ST3FAKE";
    const result = contract.updateCondition(0, "NewCondition", 15, 8);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets creation fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setCreationFee(2000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.creationFee).toBe(2000);
    contract.createCondition(
      "TestCondition",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    expect(contract.stxTransfers).toEqual([{ amount: 2000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects creation fee change without authority contract", () => {
    const result = contract.setCreationFee(2000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct condition count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createCondition(
      "Condition1",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    contract.createCondition(
      "Condition2",
      15,
      8,
      60,
      10,
      60,
      "weighted",
      15,
      14,
      "CityY",
      "USD",
      100,
      2000,
      ["ST4SIGNER2"]
    );
    const result = contract.getConditionCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks condition existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createCondition(
      "TestCondition",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    const result = contract.checkConditionExistence("TestCondition");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const result2 = contract.checkConditionExistence("NonExistent");
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });

  it("parses condition parameters with Clarity types", () => {
    const name = stringUtf8CV("TestCondition");
    const maxSigners = uintCV(10);
    const required = uintCV(5);
    expect(name.value).toBe("TestCondition");
    expect(maxSigners.value).toEqual(BigInt(10));
    expect(required.value).toEqual(BigInt(5));
  });

  it("rejects condition creation with empty name", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createCondition(
      "",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_UPDATE_PARAM);
  });

  it("rejects condition creation with max conditions exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxConditions = 1;
    contract.createCondition(
      "Condition1",
      10,
      5,
      30,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1"]
    );
    const result = contract.createCondition(
      "Condition2",
      15,
      8,
      60,
      10,
      60,
      "weighted",
      15,
      14,
      "CityY",
      "USD",
      100,
      2000,
      ["ST4SIGNER2"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_CONDITIONS_EXCEEDED);
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("rejects invalid authority contract", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("approves and verifies successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createCondition(
      "ApproveTest",
      3,
      2,
      100,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST1TEST", "ST3SIGNER1", "ST4SIGNER2"]
    );
    contract.caller = "ST3SIGNER1";
    const approve1 = contract.approve(0);
    expect(approve1.ok).toBe(true);
    contract.caller = "ST4SIGNER2";
    const approve2 = contract.approve(0);
    expect(approve2.ok).toBe(true);
    const verify = contract.verify("ST5RECIP", 0);
    expect(verify.ok).toBe(true);
    expect(verify.value).toBe(true);
  });

  it("rejects approve from non-signer", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createCondition(
      "ApproveTest",
      3,
      2,
      100,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1", "ST4SIGNER2"]
    );
    contract.caller = "ST5FAKE";
    const result = contract.approve(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_SIGNER);
  });

  it("rejects already signed approve", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createCondition(
      "ApproveTest",
      3,
      2,
      100,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1", "ST4SIGNER2"]
    );
    contract.caller = "ST3SIGNER1";
    contract.approve(0);
    const result = contract.approve(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_SIGNED);
  });

  it("verify fails if not enough approvals", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createCondition(
      "VerifyTest",
      3,
      2,
      100,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1", "ST4SIGNER2"]
    );
    contract.caller = "ST3SIGNER1";
    contract.approve(0);
    const result = contract.verify("ST5RECIP", 0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(false);
  });

  it("verify fails if timed out", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createCondition(
      "TimeoutTest",
      3,
      2,
      100,
      5,
      50,
      "simple",
      10,
      7,
      "VillageX",
      "STX",
      50,
      1000,
      ["ST3SIGNER1", "ST4SIGNER2"]
    );
    contract.caller = "ST3SIGNER1";
    contract.approve(0);
    contract.caller = "ST4SIGNER2";
    contract.approve(0);
    contract.blockHeight = 200;
    const result = contract.verify("ST5RECIP", 0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(false);
  });
});