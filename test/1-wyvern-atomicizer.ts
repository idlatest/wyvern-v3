import { ethers } from "hardhat";

describe("WyvernAtomicizer", () => {
  it("should be deployed", async () => {
    return await ethers.deployContract("WyvernAtomicizer");
  });
});
