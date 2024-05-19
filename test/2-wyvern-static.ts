import { ethers } from "hardhat";
import { expect } from "chai";

describe("WyvernStatic", () => {
  it("is deployed", async () => {
    const atomicizerInstance = await ethers.deployContract("WyvernAtomicizer");
    return await ethers.deployContract("WyvernStatic", [
      atomicizerInstance.target,
    ]);
  });

  it("has the correct atomicizer address", async () => {
    const atomicizerInstance = await ethers.deployContract("WyvernAtomicizer");
    const staticInstance = await ethers.deployContract("WyvernStatic", [
      atomicizerInstance.target,
    ]);
    expect(
      await staticInstance.atomicizer(),
      "incorrect atomicizer address"
    ).eq(atomicizerInstance.target);
  });
});
