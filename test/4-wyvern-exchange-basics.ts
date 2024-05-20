import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { expect } from "chai";

import { CHAIN_ID, wrap, hashOrder, hashToSign, NULL_SIG } from "./util";

describe("WyvernExchange", () => {
  let accounts: HardhatEthersSigner[];

  before(async function () {
    accounts = await ethers.getSigners();
  });

  const deployExchangeAndRegistryFixture = async () => {
    const wyvernRegistry = await ethers.deployContract("WyvernRegistry");
    const wyvernExchange = await ethers.deployContract("WyvernExchange", [
      CHAIN_ID,
      [wyvernRegistry.target],
      "0x",
    ]);

    await wyvernRegistry.grantInitialAuthentication(wyvernExchange.target);

    return { wyvernRegistry, wyvernExchange };
  };

  const withExchangeAndRegistry = async () => {
    let { wyvernRegistry, wyvernExchange } = await loadFixture(
      deployExchangeAndRegistryFixture
    );
    return { exchange: wyvernExchange, registry: wyvernRegistry };
  };

  it("is deployed", async () => {
    return await withExchangeAndRegistry();
  });

  it("correctly hashes order", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: ethers.ZeroAddress,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 0,
      salt: 0,
    };

    const wrappedExchange = wrap(exchange);
    const hash = await wrappedExchange.hashOrder(example);

    expect(hashOrder(example), "Incorrect order hash").to.equal(hash);
  });

  it("correctly hashes order to sign", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: ethers.ZeroAddress,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 0,
      salt: 0,
    };

    const wrappedExchange = wrap(exchange);
    const hash = await wrappedExchange.hashToSign(example);

    expect(
      hashToSign(example, exchange.target),
      "Incorrect order hash"
    ).to.equal(hash);
  });

  it("does not allow set-fill to same fill", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 6,
    };

    const wrappedExchange = wrap(exchange.connect(accounts[1]));

    await expect(
      wrappedExchange.setOrderFill(example, 0),
      "Should not have suceeded"
    ).to.be.revertedWith(/Fill is already set to the desired value/);
  });

  it("validates valid order parameters", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 0,
    };

    const wrappedExchange = wrap(exchange);

    expect(
      await wrappedExchange.validateOrderParameters(example),
      "Should have validated"
    ).to.be.true;
  });

  it("does not validate order parameters with invalid staticTarget", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: ethers.ZeroAddress,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 0,
    };

    const wrappedExchange = wrap(exchange);

    expect(
      await wrappedExchange.validateOrderParameters(example),
      "Should not have validated"
    ).to.be.false;
  });

  it("does not validate order parameters with listingTime after now", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 1000000000000,
      expirationTime: 1000000000000,
      salt: 0,
    };

    const wrappedExchange = wrap(exchange);

    expect(
      await wrappedExchange.validateOrderParameters(example),
      "Should not have validated"
    ).to.be.false;
  });

  it("does not validate order parameters with expirationTime before now", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1,
      salt: 0,
    };

    const wrappedExchange = wrap(exchange);

    expect(
      await wrappedExchange.validateOrderParameters(example),
      "Should not have validated"
    ).to.be.false;
  });

  it("validates valid authorization by signature (sign_typed_data)", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 100230,
    };

    const wrappedExchange = wrap(exchange);
    const wrappedExchangeOther = wrap(exchange.connect(accounts[5]));

    const signature = await wrappedExchange.sign(example, accounts[1]);

    const hash = hashOrder(example);

    expect(
      await wrappedExchangeOther.validateOrderAuthorization(
        hash,
        accounts[1].address,
        signature
      ),
      "Should have validated"
    ).to.be.true;
  });

  it("validates valid authorization by signature (personal_sign)", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 100231,
    };

    const hash = hashOrder(example);

    const wrappedExchange = wrap(exchange);
    const wrappedExchangeOther = wrap(exchange.connect(accounts[5]));

    const signature = await wrappedExchange.personalSign(example, accounts[1]);

    expect(
      await wrappedExchangeOther.validateOrderAuthorization(
        hash,
        accounts[1].address,
        signature
      ),
      "Should have validated"
    ).to.be.true;
  });

  it("does not validate authorization by signature with different prefix (personal_sign)", async () => {
    const prefix = Buffer.from("\x19Bogus Signed Message:\n", "binary");

    const registry = await ethers.deployContract("WyvernRegistry");
    const exchange = await ethers.deployContract("WyvernExchange", [
      CHAIN_ID,
      [await registry.getAddress()],
      prefix,
    ]);

    await registry.grantInitialAuthentication(exchange.target);

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 100231,
    };

    const wrappedExchange = wrap(exchange);
    const wrappedExchangeOther = wrap(exchange.connect(accounts[5]));

    const hash = hashOrder(example);
    const signature = await wrappedExchange.personalSign(example, accounts[1]);

    expect(
      await wrappedExchangeOther.validateOrderAuthorization(
        hash,
        accounts[1].address,
        signature
      ),
      "Should not have validated"
    ).to.be.false;
  });

  it("does not allow approval twice", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 1010,
    };

    const wrappedExchange = wrap(exchange.connect(accounts[1]));

    await wrappedExchange.approveOrder(example, false);

    await expect(
      wrappedExchange.approveOrder(example, false),
      "Should not have succeeded"
    ).to.be.revertedWith(/Order has already been approved/);
  });

  it("does not allow approval from another user", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 10101234,
    };

    const wrappedExchange = wrap(exchange.connect(accounts[2]));

    await expect(
      wrappedExchange.approveOrder(example, false),
      "Should not have succeeded"
    ).to.be.revertedWith(
      /Sender is not the maker of the order and thus not authorized to approve it/
    );
  });

  it("validates valid authorization by approval", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 10,
    };

    const wrappedExchangeOwner = wrap(exchange);
    const wrappedExchangeOther = wrap(exchange.connect(accounts[1]));

    await wrappedExchangeOther.approveOrder(example, false);

    const hash = hashOrder(example);
    const valid = await wrappedExchangeOwner.validateOrderAuthorization(
      hash,
      accounts[0].address,
      NULL_SIG
    );

    expect(valid, "Should have validated").to.be.true;
  });

  it("validates valid authorization by hash-approval", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 1,
    };

    const hash = hashOrder(example);

    const wrappedExchangeOwner = wrap(exchange.connect(accounts[1]));
    const wrappedExchangeOther = wrap(exchange.connect(accounts[5]));

    await wrappedExchangeOwner.approveOrderHash(hash);

    const valid = await wrappedExchangeOther.validateOrderAuthorization(
      hash,
      accounts[5].address,
      NULL_SIG
    );

    expect(valid, "Should have validated").to.be.true;
  });

  it("validates valid authorization by maker", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 5,
    };

    const hash = hashOrder(example);

    const wrappedExchange = wrap(exchange); // default owner = accounts[0]

    const valid = await wrappedExchange.validateOrderAuthorization(
      hash,
      accounts[0].address,
      NULL_SIG
    );

    expect(valid, "Should have validated").to.be.true;
  });

  it("validates valid authorization by cache", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 6,
    };

    const wrappedExchangeOwner = wrap(exchange);
    const wrappedExchangeOther = wrap(exchange.connect(accounts[1]));

    await wrappedExchangeOther.setOrderFill(example, 2);

    const hash = hashOrder(example);
    const valid = await wrappedExchangeOwner.validateOrderAuthorization(
      hash,
      accounts[0].address,
      NULL_SIG
    );

    expect(valid, "Should have validated").to.be.true;
  });

  it("does not validate authorization without signature", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 0,
    };

    const hash = hashOrder(example);
    const wrappedExchange = wrap(exchange);

    const valid = await wrappedExchange.validateOrderAuthorization(
      hash,
      accounts[1].address,
      NULL_SIG
    );

    expect(valid, "Should not have validated").to.be.false;
  });

  it("does not validate cancelled order", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 20,
    };

    const wrappedExchange = wrap(exchange);

    await wrappedExchange.setOrderFill(example, 1);

    const valid = await wrappedExchange.validateOrderParameters(example);

    expect(valid, "Should not have validated").to.be.false;
  });

  it("allows order cancellation by maker", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 3,
    };

    const wrappedExchange = wrap(exchange);

    expect(await wrappedExchange.setOrderFill(example, 1)).to.be.ok;
  });

  it("allows order cancellation by non-maker", async () => {
    const { exchange, registry } = await withExchangeAndRegistry();

    const example = {
      registry: registry.target,
      maker: accounts[1].address,
      staticTarget: exchange.target,
      staticSelector: "0x00000000",
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 1000000000000,
      salt: 4,
    };

    const wrappedExchange = wrap(exchange);

    expect(await wrappedExchange.setOrderFill(example, 1)).to.be.ok;
  });
});
