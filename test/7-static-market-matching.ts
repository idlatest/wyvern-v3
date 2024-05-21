import { artifacts } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { ethers } from "hardhat";
import { expect } from "chai";

import { wrap, ZERO_BYTES32, CHAIN_ID } from "./util";

interface AnyERC1155ForERC20Options {
  tokenId: number;
  buyTokenId?: number;
  sellAmount: number;
  sellingPrice: number;
  buyingPrice: number;
  buyAmount: number;
  account_a: HardhatEthersSigner;
  account_b: HardhatEthersSigner;
  sender: HardhatEthersSigner;
  transactions?: number;
  erc1155MintAmount: number;
  erc20MintAmount: number;
  sellingNumerator?: number;
  buyingDenominator?: number;
}

interface AnyERC20ForERC20Options {
  sellAmount: number;
  sellingPrice: number;
  buyingPrice: number;
  buyPriceOffset?: number;
  buyAmount: number;
  erc20MintAmountBuyer: number;
  erc20MintAmountSeller: number;
  account_a: HardhatEthersSigner;
  account_b: HardhatEthersSigner;
  sender: HardhatEthersSigner;
  transactions?: number;
}

interface ERC721ForERC20Options {
  tokenId: number;
  buyTokenId?: number;
  sellingPrice: number;
  buyingPrice: number;
  account_a: HardhatEthersSigner;
  account_b: HardhatEthersSigner;
  sender: HardhatEthersSigner;
  erc20MintAmount: number;
}

const abiCoder = new ethers.AbiCoder();

describe("WyvernExchange", () => {
  let accounts: HardhatEthersSigner[];

  beforeEach(async () => {
    accounts = await ethers.getSigners();
  });

  const deployCoreContractsFixture = async () => {
    const [registry, atomicizer] = await Promise.all([
      ethers.deployContract("WyvernRegistry"),
      ethers.deployContract("WyvernAtomicizer"),
    ]);
    const [exchange, statici] = await Promise.all([
      ethers.deployContract("WyvernExchange", [
        CHAIN_ID,
        [registry.target],
        "0x",
      ]),
      ethers.deployContract("StaticMarket"),
    ]);

    await registry.grantInitialAuthentication(exchange.target);
    return { registry, exchange, atomicizer, statici };
  };

  const deployTestERC20Fixture = async () =>
    await ethers.deployContract("TestERC20");

  const deployTestERC721Fixture = async () =>
    await ethers.deployContract("TestERC721");

  const deployTestERC1155Fixture = async () =>
    await ethers.deployContract("TestERC1155");

  const any_erc1155_for_erc20_test = async (
    options: AnyERC1155ForERC20Options
  ) => {
    const {
      tokenId,
      buyTokenId,
      sellAmount,
      sellingPrice,
      sellingNumerator,
      buyingPrice,
      buyAmount,
      buyingDenominator,
      erc1155MintAmount,
      erc20MintAmount,
      account_a,
      account_b,
      sender,
      transactions,
    } = options;

    const txCount = transactions || 1;

    const { exchange, registry, statici } = await loadFixture(
      deployCoreContractsFixture
    );
    const [erc20, erc1155] = await Promise.all([
      loadFixture(deployTestERC20Fixture),
      loadFixture(deployTestERC1155Fixture),
    ]);

    await registry.connect(account_a).registerProxy();

    const proxy1 = await registry.proxies(account_a.address);
    expect(proxy1.length, "no proxy address for account a").to.be.greaterThan(
      0
    );

    await registry.connect(account_b).registerProxy();

    const proxy2 = await registry.proxies(account_b.address);
    expect(proxy2.length, "no proxy address for account b").to.be.greaterThan(
      0
    );

    await Promise.all([
      erc1155.connect(account_a).setApprovalForAll(proxy1, true),
      erc20.connect(account_b).approve(proxy2, erc20MintAmount),
    ]);
    await Promise.all([
      erc1155["mint(address,uint256,uint256)"](
        account_a.address,
        tokenId,
        erc1155MintAmount
      ),
      erc20.mint(account_b.address, erc20MintAmount),
    ]);

    if (buyTokenId)
      await erc1155["mint(address,uint256,uint256)"](
        account_a.address,
        buyTokenId,
        erc1155MintAmount
      );

    const StaticMarketArtifact = await artifacts.readArtifact("StaticMarket");

    const staticMarketIface = new ethers.Interface(StaticMarketArtifact.abi);

    const selectorOne = staticMarketIface.getFunction(
      "anyERC1155ForERC20(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;
    const selectorTwo = staticMarketIface.getFunction(
      "anyERC20ForERC1155(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const paramsOne = abiCoder.encode(
      ["address[2]", "uint256[3]"],
      [
        [erc1155.target, erc20.target],
        [tokenId, sellingNumerator || 1, sellingPrice],
      ]
    );

    const paramsTwo = abiCoder.encode(
      ["address[2]", "uint256[3]"],
      [
        [erc20.target, erc1155.target],
        [buyTokenId || tokenId, buyingPrice, buyingDenominator || 1],
      ]
    );

    const one = {
      registry: registry.target,
      maker: account_a.address,
      staticTarget: statici.target,
      staticSelector: selectorOne,
      staticExtradata: paramsOne,
      maximumFill: (sellingNumerator || 1) * sellAmount,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 11,
    };

    const two = {
      registry: registry.target,
      maker: account_b.address,
      staticTarget: statici.target,
      staticSelector: selectorTwo,
      staticExtradata: paramsTwo,
      maximumFill: buyingPrice * buyAmount,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 12,
    };

    const TestERC20Artifact = await artifacts.readArtifact("TestERC20");
    const TestERC1155Artifact = await artifacts.readArtifact("TestERC1155");

    const erc20Iface = new ethers.Interface(TestERC20Artifact.abi);
    const erc1155Iface = new ethers.Interface(TestERC1155Artifact.abi);

    const firstData =
      erc1155Iface.encodeFunctionData("safeTransferFrom", [
        account_a.address,
        account_b.address,
        tokenId,
        sellingNumerator || buyAmount,
        "0x",
      ]) + ZERO_BYTES32.substr(2);
    const secondData = erc20Iface.encodeFunctionData("transferFrom", [
      account_b.address,
      account_a.address,
      buyAmount * buyingPrice,
    ]);

    const firstCall = {
      target: erc1155.target,
      howToCall: 0,
      data: firstData,
    };
    const secondCall = {
      target: erc20.target,
      howToCall: 0,
      data: secondData,
    };

    const wrappedExchange = wrap(exchange);

    const sigOne = await wrappedExchange.sign(one, account_a);

    for (var i = 0; i < txCount; ++i) {
      const sigTwo = await wrappedExchange.sign(two, account_b);
      await wrap(exchange.connect(sender || account_a)).atomicMatchWith(
        one,
        sigOne,
        firstCall,
        two,
        sigTwo,
        secondCall,
        ZERO_BYTES32
      );
      two.salt++;
    }

    const [account_a_erc20_balance, account_b_erc1155_balance] =
      await Promise.all([
        erc20.balanceOf(account_a.address),
        erc1155.balanceOf(account_b.address, tokenId),
      ]);
    expect(account_a_erc20_balance, "Incorrect ERC20 balance").to.equal(
      sellingPrice * buyAmount * txCount
    );
    expect(account_b_erc1155_balance, "Incorrect ERC1155 balance").to.equal(
      sellingNumerator || buyAmount * txCount
    );
  };

  it("StaticMarket: matches erc1155 <> erc20 order, 1 fill", async () => {
    const price = 10000;

    return any_erc1155_for_erc20_test({
      tokenId: 5,
      sellAmount: 1,
      sellingPrice: price,
      buyingPrice: price,
      buyAmount: 1,
      erc1155MintAmount: 1,
      erc20MintAmount: price,
      account_a: accounts[0],
      account_b: accounts[6],
      sender: accounts[1],
    });
  });

  it("StaticMarket: matches erc1155 <> erc20 order, multiple fills in 1 transaction", async () => {
    const amount = 3;
    const price = 10000;

    return any_erc1155_for_erc20_test({
      tokenId: 5,
      sellAmount: amount,
      sellingPrice: price,
      buyingPrice: price,
      buyAmount: amount,
      erc1155MintAmount: amount,
      erc20MintAmount: amount * price,
      account_a: accounts[0],
      account_b: accounts[6],
      sender: accounts[1],
    });
  });

  it("StaticMarket: matches erc1155 <> erc20 order, multiple fills in multiple transactions", async () => {
    const nftAmount = 3;
    const buyAmount = 1;
    const price = 10000;
    const transactions = 3;

    return any_erc1155_for_erc20_test({
      tokenId: 5,
      sellAmount: nftAmount,
      sellingPrice: price,
      buyingPrice: price,
      buyAmount,
      erc1155MintAmount: nftAmount,
      erc20MintAmount: buyAmount * price * transactions,
      account_a: accounts[0],
      account_b: accounts[6],
      sender: accounts[1],
      transactions,
    });
  });

  it("StaticMarket: matches erc1155 <> erc20 order, allows any partial fill", async () => {
    const nftAmount = 30;
    const buyAmount = 4;
    const price = 10000;

    return any_erc1155_for_erc20_test({
      tokenId: 5,
      sellAmount: nftAmount,
      sellingPrice: price,
      buyingPrice: price,
      buyAmount,
      erc1155MintAmount: nftAmount,
      erc20MintAmount: buyAmount * price,
      account_a: accounts[0],
      account_b: accounts[6],
      sender: accounts[1],
    });
  });

  it("StaticMarket: matches erc1155 <> erc20 order with any matching ratio", async () => {
    const lot = 83974;
    const price = 972;

    return any_erc1155_for_erc20_test({
      tokenId: 5,
      sellAmount: 6,
      sellingNumerator: lot,
      sellingPrice: price,
      buyingPrice: price,
      buyingDenominator: lot,
      buyAmount: 1,
      erc1155MintAmount: lot,
      erc20MintAmount: price,
      account_a: accounts[0],
      account_b: accounts[6],
      sender: accounts[1],
    });
  });

  it("StaticMarket: does not match erc1155 <> erc20 order beyond maximum fill", async () => {
    const price = 10000;

    return await expect(
      any_erc1155_for_erc20_test({
        tokenId: 5,
        sellAmount: 1,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount: 1,
        erc1155MintAmount: 2,
        erc20MintAmount: price * 2,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
        transactions: 2,
      }),
      "Order should not match the second time."
    ).to.be.revertedWith(/First order has invalid parameters/);
  });

  it("StaticMarket: does not fill erc1155 <> erc20 order with different prices", async () => {
    const price = 10000;

    return await expect(
      any_erc1155_for_erc20_test({
        tokenId: 5,
        sellAmount: 1,
        sellingPrice: price,
        buyingPrice: price - 10,
        buyAmount: 1,
        erc1155MintAmount: 1,
        erc20MintAmount: price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not match."
    ).to.be.revertedWith(/Static call failed/);
  });

  it("StaticMarket: does not fill erc1155 <> erc20 order with different ratios", async () => {
    const price = 10000;

    return await expect(
      any_erc1155_for_erc20_test({
        tokenId: 5,
        sellAmount: 1,
        sellingPrice: price,
        buyingPrice: price,
        buyingDenominator: 2,
        buyAmount: 1,
        erc1155MintAmount: 1,
        erc20MintAmount: price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not match."
    ).to.be.revertedWith(/Static call failed/);
  });

  it("StaticMarket: does not fill erc1155 <> erc20 order beyond maximum sell amount", async () => {
    const nftAmount = 2;
    const buyAmount = 3;
    const price = 10000;

    return await expect(
      any_erc1155_for_erc20_test({
        tokenId: 5,
        sellAmount: nftAmount,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount,
        erc1155MintAmount: nftAmount,
        erc20MintAmount: buyAmount * price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not fill"
    ).to.be.revertedWith(/First call failed/);
  });

  it("StaticMarket: does not fill erc1155 <> erc20 order if balance is insufficient", async () => {
    const nftAmount = 1;
    const buyAmount = 1;
    const price = 10000;

    return await expect(
      any_erc1155_for_erc20_test({
        tokenId: 5,
        sellAmount: nftAmount,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount,
        erc1155MintAmount: nftAmount,
        erc20MintAmount: buyAmount * price - 1,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not fill"
    ).to.be.revertedWith(/Second call failed/);
  });

  it("StaticMarket: does not fill erc1155 <> erc20 order if the token IDs are different", async () => {
    const price = 10000;

    return await expect(
      any_erc1155_for_erc20_test({
        tokenId: 5,
        buyTokenId: 6,
        sellAmount: 1,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount: 1,
        erc1155MintAmount: 1,
        erc20MintAmount: price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not match the second time."
    ).to.be.revertedWith(/Static call failed/);
  });

  const any_erc20_for_erc20_test = async (options: AnyERC20ForERC20Options) => {
    const {
      sellAmount,
      sellingPrice,
      buyingPrice,
      buyPriceOffset,
      buyAmount,
      erc20MintAmountSeller,
      erc20MintAmountBuyer,
      account_a,
      account_b,
      sender,
      transactions,
    } = options;

    const txCount = transactions || 1;
    const takerPriceOffset = buyPriceOffset || 0;

    const { exchange, registry, statici } = await loadFixture(
      deployCoreContractsFixture
    );
    const [erc20Seller, erc20Buyer] = await Promise.all([
      loadFixture(deployTestERC20Fixture),
      loadFixture(deployTestERC20Fixture),
    ]);

    await registry.connect(account_a).registerProxy();
    const proxy1 = await registry.proxies(account_a.address);
    expect(proxy1.length, "no proxy address for account a").to.be.greaterThan(
      0
    );

    await registry.connect(account_b).registerProxy();
    const proxy2 = await registry.proxies(account_b.address);
    expect(proxy2.length, "no proxy address for account b").to.be.greaterThan(
      0
    );

    await Promise.all([
      erc20Seller.connect(account_a).approve(proxy1, erc20MintAmountSeller),
      erc20Buyer.connect(account_b).approve(proxy2, erc20MintAmountBuyer),
    ]);
    await Promise.all([
      erc20Seller.mint(account_a.address, erc20MintAmountSeller),
      erc20Buyer.mint(account_b.address, erc20MintAmountBuyer),
    ]);

    const StaticMarketArtifact = await artifacts.readArtifact("StaticMarket");

    const staticMarketIface = new ethers.Interface(StaticMarketArtifact.abi);

    const selector = staticMarketIface.getFunction(
      "anyERC20ForERC20(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const paramsOne = abiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc20Seller.target, erc20Buyer.target],
        [sellingPrice, buyingPrice],
      ]
    );

    const paramsTwo = abiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc20Buyer.target, erc20Seller.target],
        [buyingPrice + takerPriceOffset, sellingPrice],
      ]
    );
    const one = {
      registry: registry.target,
      maker: account_a.address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsOne,
      maximumFill: sellAmount,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 11,
    };
    const two = {
      registry: registry.target,
      maker: account_b.address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsTwo,
      maximumFill: txCount * sellingPrice * buyAmount,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 12,
    };

    const TestERC20Artifact = await artifacts.readArtifact("TestERC20");
    const erc20Iface = new ethers.Interface(TestERC20Artifact.abi);

    const firstData = erc20Iface.encodeFunctionData("transferFrom", [
      account_a.address,
      account_b.address,
      buyAmount,
    ]);
    const secondData = erc20Iface.encodeFunctionData("transferFrom", [
      account_b.address,
      account_a.address,
      buyAmount * sellingPrice,
    ]);

    const firstCall = {
      target: erc20Seller.target,
      howToCall: 0,
      data: firstData,
    };
    const secondCall = {
      target: erc20Buyer.target,
      howToCall: 0,
      data: secondData,
    };

    const wrappedExchange = wrap(exchange);

    let sigOne = await wrappedExchange.sign(one, account_a);

    for (var i = 0; i < txCount; ++i) {
      let sigTwo = await wrappedExchange.sign(two, account_b);
      await wrap(exchange.connect(sender || account_a)).atomicMatchWith(
        one,
        sigOne,
        firstCall,
        two,
        sigTwo,
        secondCall,
        ZERO_BYTES32
      );
      two.salt++;
    }

    let [account_a_erc20_balance, account_b_erc20_balance] = await Promise.all([
      erc20Buyer.balanceOf(account_a.address),
      erc20Seller.balanceOf(account_b.address),
    ]);
    expect(account_a_erc20_balance, "Incorrect ERC20 balance").to.equal(
      sellingPrice * buyAmount * txCount
    );
    expect(account_b_erc20_balance, "Incorrect ERC20 balance").to.be.equal(
      buyAmount * txCount
    );
  };

  it("StaticMarket: matches erc20 <> erc20 order, 1 fill", async () => {
    const price = 10000;

    return any_erc20_for_erc20_test({
      sellAmount: 1,
      sellingPrice: price,
      buyingPrice: 1,
      buyAmount: 1,
      erc20MintAmountSeller: 1,
      erc20MintAmountBuyer: price,
      account_a: accounts[0],
      account_b: accounts[6],
      sender: accounts[1],
    });
  });

  it("StaticMarket: matches erc20 <> erc20 order, multiple fills in 1 transaction", async () => {
    const amount = 3;
    const price = 10000;

    return any_erc20_for_erc20_test({
      sellAmount: amount,
      sellingPrice: price,
      buyingPrice: 1,
      buyAmount: amount,
      erc20MintAmountSeller: amount,
      erc20MintAmountBuyer: amount * price,
      account_a: accounts[0],
      account_b: accounts[6],
      sender: accounts[1],
    });
  });

  it("StaticMarket: matches erc20 <> erc20 order, multiple fills in multiple transactions", async () => {
    const sellAmount = 3;
    const buyAmount = 1;
    const price = 10000;
    const transactions = 3;

    return any_erc20_for_erc20_test({
      sellAmount,
      sellingPrice: price,
      buyingPrice: 1,
      buyAmount,
      erc20MintAmountSeller: sellAmount,
      erc20MintAmountBuyer: buyAmount * price * transactions,
      account_a: accounts[0],
      account_b: accounts[6],
      sender: accounts[1],
      transactions,
    });
  });

  it("StaticMarket: matches erc20 <> erc20 order, allows any partial fill", async () => {
    const sellAmount = 30;
    const buyAmount = 4;
    const price = 10000;

    return any_erc20_for_erc20_test({
      sellAmount,
      sellingPrice: price,
      buyingPrice: 1,
      buyAmount,
      erc20MintAmountSeller: sellAmount,
      erc20MintAmountBuyer: buyAmount * price,
      account_a: accounts[0],
      account_b: accounts[6],
      sender: accounts[1],
    });
  });

  it("StaticMarket: does not match erc20 <> erc20 order beyond maximum fill", async () => {
    const price = 10000;

    return await expect(
      any_erc20_for_erc20_test({
        sellAmount: 1,
        sellingPrice: price,
        buyingPrice: 1,
        buyAmount: 1,
        erc20MintAmountSeller: 2,
        erc20MintAmountBuyer: price * 2,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
        transactions: 2,
      }),
      "Order should not match the second time."
    ).to.be.revertedWith(/First order has invalid parameters/);
  });

  it("StaticMarket: does not fill erc20 <> erc20 order with different taker price", async () => {
    const price = 10000;

    return await expect(
      any_erc20_for_erc20_test({
        sellAmount: 1,
        sellingPrice: price,
        buyingPrice: 1,
        buyPriceOffset: 1,
        buyAmount: 1,
        erc20MintAmountSeller: 2,
        erc20MintAmountBuyer: price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not match."
    ).to.be.revertedWith(/Static call failed/);
  });

  it("StaticMarket: does not fill erc20 <> erc20 order beyond maximum sell amount", async () => {
    const sellAmount = 2;
    const buyAmount = 3;
    const price = 10000;

    return await expect(
      any_erc20_for_erc20_test({
        sellAmount,
        sellingPrice: price,
        buyingPrice: 1,
        buyAmount,
        erc20MintAmountSeller: sellAmount,
        erc20MintAmountBuyer: buyAmount * price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not fill"
    ).to.be.revertedWith(/First call failed/);
  });

  it("StaticMarket: does not fill erc20 <> erc20 order if balance is insufficient", async () => {
    const sellAmount = 1;
    const buyAmount = 1;
    const price = 10000;

    return await expect(
      any_erc20_for_erc20_test({
        sellAmount,
        sellingPrice: price,
        buyingPrice: 1,
        buyAmount,
        erc20MintAmountSeller: sellAmount,
        erc20MintAmountBuyer: buyAmount * price - 1,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not fill"
    ).to.be.revertedWith(/Second call failed/);
  });

  const erc721_for_erc20_test = async (options: ERC721ForERC20Options) => {
    const {
      tokenId,
      buyTokenId,
      sellingPrice,
      buyingPrice,
      erc20MintAmount,
      account_a,
      account_b,
      sender,
    } = options;

    const { exchange, registry, statici } = await loadFixture(
      deployCoreContractsFixture
    );
    const [erc721, erc20] = await Promise.all([
      loadFixture(deployTestERC721Fixture),
      loadFixture(deployTestERC20Fixture),
    ]);

    await registry.connect(account_a).registerProxy();
    const proxy1 = await registry.proxies(account_a.address);
    expect(proxy1.length, "no proxy address for account a").to.be.greaterThan(
      0
    );

    await registry.connect(account_b).registerProxy();
    const proxy2 = await registry.proxies(account_b.address);
    expect(proxy2.length, "no proxy address for account b").to.be.greaterThan(
      0
    );

    await Promise.all([
      erc721.connect(account_a).setApprovalForAll(proxy1, true),
      erc20.connect(account_b).approve(proxy2, erc20MintAmount),
    ]);
    await Promise.all([
      erc721.connect(account_a).mint(account_a.address, tokenId),
      erc20.connect(account_b).mint(account_b.address, erc20MintAmount),
    ]);

    if (buyTokenId)
      await erc721.connect(account_a).mint(account_a.address, buyTokenId);

    const StaticMarketArtifact = await artifacts.readArtifact("StaticMarket");

    const staticMarketIface = new ethers.Interface(StaticMarketArtifact.abi);

    const selectorOne = staticMarketIface.getFunction(
      "ERC721ForERC20(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;
    const selectorTwo = staticMarketIface.getFunction(
      "ERC20ForERC721(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const paramsOne = abiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc721.target, erc20.target],
        [tokenId, sellingPrice],
      ]
    );

    const paramsTwo = abiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc20.target, erc721.target],
        [buyTokenId || tokenId, buyingPrice],
      ]
    );

    const one = {
      registry: registry.target,
      maker: account_a.address,
      staticTarget: statici.target,
      staticSelector: selectorOne,
      staticExtradata: paramsOne,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 11,
    };
    const two = {
      registry: registry.target,
      maker: account_b.address,
      staticTarget: statici.target,
      staticSelector: selectorTwo,
      staticExtradata: paramsTwo,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 12,
    };

    const TestERC20Artifact = await artifacts.readArtifact("TestERC20");
    const TestERC721Artifact = await artifacts.readArtifact("TestERC721");

    const erc20Iface = new ethers.Interface(TestERC20Artifact.abi);
    const erc721Iface = new ethers.Interface(TestERC721Artifact.abi);

    const firstData = erc721Iface.encodeFunctionData("transferFrom", [
      account_a.address,
      account_b.address,
      tokenId,
    ]);
    const secondData = erc20Iface.encodeFunctionData("transferFrom", [
      account_b.address,
      account_a.address,
      buyingPrice,
    ]);

    const firstCall = { target: erc721.target, howToCall: 0, data: firstData };
    const secondCall = {
      target: erc20.target,
      howToCall: 0,
      data: secondData,
    };

    const wrappedExchange = wrap(exchange);

    const sigOne = await wrappedExchange.sign(one, account_a);
    const sigTwo = await wrappedExchange.sign(two, account_b);
    await wrap(exchange.connect(sender || account_a)).atomicMatchWith(
      one,
      sigOne,
      firstCall,
      two,
      sigTwo,
      secondCall,
      ZERO_BYTES32
    );

    const [account_a_erc20_balance, token_owner] = await Promise.all([
      erc20.balanceOf(account_a.address),
      erc721.ownerOf(tokenId),
    ]);

    expect(account_a_erc20_balance, "Incorrect ERC20 balance").to.equal(
      sellingPrice
    );
    expect(token_owner, "Incorrect token owner").to.equal(account_b);
  };

  it("StaticMarket: matches erc721 <> erc20 order", async () => {
    const price = 15000;

    return erc721_for_erc20_test({
      tokenId: 10,
      sellingPrice: price,
      buyingPrice: price,
      erc20MintAmount: price,
      account_a: accounts[0],
      account_b: accounts[6],
      sender: accounts[1],
    });
  });

  it("StaticMarket: does not fill erc721 <> erc20 order with different prices", async () => {
    const price = 15000;

    return await expect(
      erc721_for_erc20_test({
        tokenId: 10,
        sellingPrice: price,
        buyingPrice: price - 1,
        erc20MintAmount: price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not have matched"
    ).to.be.revertedWith(/Static call failed/);
  });

  it("StaticMarket: does not fill erc721 <> erc20 order if the balance is insufficient", async () => {
    const price = 15000;

    return await expect(
      erc721_for_erc20_test({
        tokenId: 10,
        sellingPrice: price,
        buyingPrice: price,
        erc20MintAmount: price - 1,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not have matched"
    ).to.be.revertedWith(/Second call failed/);
  });

  it("StaticMarket: does not fill erc721 <> erc20 order if the token IDs are different", async () => {
    const price = 15000;

    return await expect(
      erc721_for_erc20_test({
        tokenId: 10,
        buyTokenId: 11,
        sellingPrice: price,
        buyingPrice: price,
        erc20MintAmount: price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[1],
      }),
      "Order should not have matched"
    ).to.be.revertedWith(/Static call failed/);
  });
});
