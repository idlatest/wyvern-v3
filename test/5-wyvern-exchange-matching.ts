import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, artifacts } from "hardhat";
import { expect } from "chai";

import {
  wrap,
  hashOrder,
  ZERO_BYTES32,
  randomUint,
  NULL_SIG,
  // assertIsRejected,
  CHAIN_ID,
} from "./util";

const abiCoder = new ethers.AbiCoder();

describe("WyvernExchange", () => {
  let accounts: HardhatEthersSigner[];

  before(async function () {
    accounts = await ethers.getSigners();
  });

  const deployContractsFixture = async () => {
    const [
      wyvernRegistry,
      wyvernAtomicizer,
      testERC20,
      testERC721,
      testERC1271,
      testSmartContractWallet,
    ] = await Promise.all([
      ethers.deployContract("WyvernRegistry"),
      ethers.deployContract("WyvernAtomicizer"),
      ethers.deployContract("TestERC20"),
      ethers.deployContract("TestERC721"),
      ethers.deployContract("TestERC1271"),
      ethers.deployContract("TestSmartContractWallet"),
    ]);
    const [wyvernExchange, wyvernStatic] = await Promise.all([
      ethers.deployContract("WyvernExchange", [
        CHAIN_ID,
        [wyvernRegistry.target],
        "0x",
      ]),
      ethers.deployContract("WyvernStatic", [wyvernAtomicizer.target]),
    ]);

    await wyvernRegistry.grantInitialAuthentication(wyvernExchange.target);

    return [
      wyvernRegistry,
      wyvernExchange,
      wyvernAtomicizer,
      wyvernStatic,
      testERC20,
      testERC721,
      testERC1271,
      testSmartContractWallet,
    ];
  };

  const withContracts = async () => {
    const [
      registry,
      exchange,
      atomicizer,
      statici,
      erc20,
      erc721,
      erc1271,
      smartContractWallet,
    ] = await loadFixture(deployContractsFixture);

    return {
      exchange,
      statici,
      registry,
      atomicizer,
      erc20,
      erc721,
      erc1271,
      smartContractWallet,
    };
  };

  // Returns an array of two NFTs, one to give and one to get
  const withAsymmetricalTokens = async () => {
    const { erc721 } = await withContracts();
    const nfts = [4, 5];

    await Promise.all([
      erc721.mint(accounts[0], nfts[0]),
      erc721.mint(accounts[6], nfts[1]),
    ]);

    return { nfts, erc721 };
  };

  const withAsymmetricalTokens2 = async () => {
    const { erc721 } = await withContracts();
    const nfts = [6, 7];

    await Promise.all([
      erc721.mint(accounts[0], nfts[0]),
      erc721.mint(accounts[6], nfts[1]),
    ]);

    return { nfts, erc721 };
  };

  const withSomeTokens = async () => {
    const { erc20, erc721 } = await withContracts();
    const amount = randomUint() + 2;

    await erc20.mint(accounts[0], amount);

    return { tokens: amount, nfts: [1, 2, 3], erc20, erc721 };
  };

  const withTokens = async () => {
    const { erc20 } = await withContracts();
    const amount = randomUint() + 2;

    await Promise.all([
      erc20.mint(accounts[0], amount),
      erc20.mint(accounts[6], amount),
    ]);

    return { erc20 };
  };

  it("allows proxy transfer approval", async () => {
    const { registry, erc20, erc721 } = await withContracts();

    await registry.connect(accounts[0]).registerProxy();

    const proxy = await registry.proxies(accounts[0].address);

    expect(proxy.length, "No proxy address").to.be.greaterThan(0);
    expect(await erc20.approve(proxy, 100000)).to.be.ok;
    expect(await erc721.setApprovalForAll(proxy, true)).to.be.ok;
  });

  it("allows proxy registration", async () => {
    const { registry, erc20, erc721 } = await withContracts();
    await registry.connect(accounts[6]).registerProxy();

    const proxy = await registry.proxies(accounts[6].address);

    expect(proxy.length, "No proxy address").to.be.greaterThan(0);
    expect(await erc20.connect(accounts[6]).approve(proxy, 100000)).to.be.ok;
    expect(await erc721.connect(accounts[6]).setApprovalForAll(proxy, true)).to
      .be.ok;
  });

  it("allows proxy registration, erc1271", async () => {
    const { registry, erc1271 } = await withContracts();

    await registry.registerProxyFor(erc1271.target);

    const proxy = await registry.proxies(erc1271.target);
    expect(proxy.length, "No proxy address").to.be.greaterThan(0);
  });

  it("matches any-any nop order", async () => {
    const { exchange, registry, statici } = await withContracts();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    // NOTICE: hardhat network reset states after each test
    // so we have to call registerProxy() every time
    // or else a "Delegate proxy does not exist for maker" error
    // will occure
    await registry.connect(accounts[0]).registerProxy();

    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 0,
    };

    const two = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 1,
    };

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    const wrappedExchange = wrap(exchange);

    expect(
      await wrappedExchange.atomicMatch(
        one,
        NULL_SIG,
        call,
        two,
        NULL_SIG,
        call,
        ZERO_BYTES32
      )
    ).to.be.ok;
  });

  it("does not match any-any nop order with wrong registry", async () => {
    const { exchange, registry, statici } = await withContracts();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    // NOTICE: hardhat network reset states after each test
    // so we have to call registerProxy() every time
    // or else a "Delegate proxy does not exist for maker" error
    // will occure
    await registry.connect(accounts[0]).registerProxy();

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 2330,
    };

    const two = {
      registry: statici.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 2331,
    };

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    const wrappedExchange = wrap(exchange);

    await expect(
      wrappedExchange.atomicMatch(
        one,
        NULL_SIG,
        call,
        two,
        NULL_SIG,
        call,
        ZERO_BYTES32
      ),
      "Should not have matched"
    ).to.be.revertedWithoutReason();
  });

  it("matches any-any nop order, erc 1271", async () => {
    const { exchange, registry, statici, erc1271 } = await withContracts();

    // NOTICE: hardhat network reset states after each test
    // so we have to call registerProxy() every time
    // or else a "Delegate proxy does not exist for maker" error
    // will occure
    await registry.connect(accounts[0]).registerProxyFor(erc1271.target);
    await registry.connect(accounts[0]).registerProxy();

    await erc1271.setOwner(accounts[0].address);

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: erc1271.target,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 410,
    };

    const two = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 411,
    };

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    const wrappedExchange = wrap(exchange);

    const signature = await wrappedExchange.sign(one, accounts[0]);

    expect(
      await wrappedExchange.atomicMatch(
        one,
        signature,
        call,
        two,
        NULL_SIG,
        call,
        ZERO_BYTES32
      )
    ).to.be.ok;
  });

  it("does not match any-any nop order with bad sig, erc 1271", async () => {
    const { exchange, registry, statici, erc1271 } = await withContracts();

    await erc1271.setOwner(accounts[0].address);

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: erc1271.target,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 410,
    };
    const two = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 411,
    };
    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    const wrappedExchange = wrap(exchange);

    const signature = await wrappedExchange.sign(two, accounts[0]);

    // Notice: the commented assertion was used for the original test
    // but I am now getting a different error
    // (which seems right looking at the contract code, bad signature
    // does not cause invalid parameters error)

    // return await expect(
    //   wrappedExchange.atomicMatch(
    //     one,
    //     signature,
    //     call,
    //     two,
    //     NULL_SIG,
    //     call,
    //     ZERO_BYTES32
    //   ),
    //   "Should not have matched"
    // ).to.be.revertedWith(/First order has invalid parameters/);
    return await expect(
      wrappedExchange.atomicMatch(
        one,
        signature,
        call,
        two,
        NULL_SIG,
        call,
        ZERO_BYTES32
      ),
      "Should not have matched"
    ).to.be.revertedWith(/First order failed authorization/);
  });

  it("matches any-any nop order twice with no fill", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[0]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "anyNoFill(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    const wrappedExchange = wrap(exchange);

    expect(
      await wrappedExchange.atomicMatch(
        one,
        NULL_SIG,
        call,
        two,
        NULL_SIG,
        call,
        ZERO_BYTES32
      )
    ).to.be.ok;
    expect(
      await wrappedExchange.atomicMatch(
        one,
        NULL_SIG,
        call,
        two,
        NULL_SIG,
        call,
        ZERO_BYTES32
      )
    ).to.be.ok;
  });

  it("matches exactly twice with two-fill", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "anyAddOne(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 2,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 2,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    const wrappedExchange = wrap(exchange);

    const [signature1, signature2] = await Promise.all([
      wrappedExchange.sign(one, accounts[6]),
      wrappedExchange.sign(two, accounts[6]),
    ]);

    await Promise.all([
      wrappedExchange.atomicMatch(
        one,
        signature1,
        call,
        two,
        signature2,
        call,
        ZERO_BYTES32
      ),
      wrappedExchange.atomicMatch(
        one,
        signature1,
        call,
        two,
        signature2,
        call,
        ZERO_BYTES32
      ),
    ]);

    await expect(
      wrappedExchange.atomicMatch(
        one,
        signature1,
        call,
        two,
        signature2,
        call,
        ZERO_BYTES32
      ),
      "Should not have succeeded"
    ).to.be.revertedWith(/First order has invalid parameters/);
  });

  it("should not self-match", async () => {
    const { exchange, registry, statici } = await withContracts();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);

    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 0,
    };
    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };
    return await expect(
      wrap(exchange).atomicMatch(
        one,
        NULL_SIG,
        call,
        one,
        NULL_SIG,
        call,
        ZERO_BYTES32
      ),
      "Should not have succeeded"
    ).to.be.revertedWith(/Self-matching orders is prohibited/);
  });

  it("does not match any-any reentrant order", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[0]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);

    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 4,
    };
    const two = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 5,
    };

    const WyvernExchangeArtifact = await artifacts.readArtifact(
      "WyvernExchange"
    );

    const wyvernExchangeIface = new ethers.Interface(
      WyvernExchangeArtifact.abi
    );

    const call1 = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    const data = wyvernExchangeIface.encodeFunctionData("atomicMatch_", [
      [
        one.registry,
        one.maker,
        one.staticTarget,
        one.maximumFill,
        one.listingTime,
        one.expirationTime,
        one.salt,
        call1.target,
        two.registry,
        two.maker,
        two.staticTarget,
        two.maximumFill,
        two.listingTime,
        two.expirationTime,
        two.salt,
        call1.target,
      ],
      [one.staticSelector, two.staticSelector],
      one.staticExtradata,
      call1.data,
      two.staticExtradata,
      call1.data,
      [call1.howToCall, call1.howToCall],
      ZERO_BYTES32,
      abiCoder.encode(
        ["bytes", "bytes"],
        [
          abiCoder.encode(
            ["uint8", "bytes32", "bytes32"],
            [NULL_SIG.v, NULL_SIG.r, NULL_SIG.s]
          ),
          abiCoder.encode(
            ["uint8", "bytes32", "bytes32"],
            [NULL_SIG.v, NULL_SIG.r, NULL_SIG.s]
          ),
        ]
      ),
    ]);

    const call2 = { target: exchange.target, howToCall: 0, data: data };

    return await expect(
      wrap(exchange).atomicMatch(
        one,
        NULL_SIG,
        call1,
        two,
        NULL_SIG,
        call2,
        ZERO_BYTES32
      ),
      "Should not have succeeded"
    ).to.be.revertedWith(/Second call failed/);
  });

  it("matches nft-nft swap order", async () => {
    const { exchange, registry, statici } = await withContracts();
    const { nfts, erc721 } = await withAsymmetricalTokens();

    await registry.connect(accounts[0]).registerProxy();
    const proxy1 = await registry.proxies(accounts[0].address);
    expect(proxy1.length, "no proxy address for account[0]").to.be.greaterThan(
      0
    );

    await registry.connect(accounts[6]).registerProxy();
    const proxy2 = await registry.proxies(accounts[6].address);
    expect(proxy2.length, "no proxy address for account[6]").to.be.greaterThan(
      0
    );

    await Promise.all([
      erc721.connect(accounts[0]).setApprovalForAll(proxy1, true),
      erc721.connect(accounts[6]).setApprovalForAll(proxy2, true),
    ]);

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);

    const selector = wyvernStaicIface.getFunction(
      "swapOneForOneERC721(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const paramsOne = abiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc721.target, erc721.target],
        [nfts[0], nfts[1]],
      ]
    );
    const paramsTwo = abiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc721.target, erc721.target],
        [nfts[1], nfts[0]],
      ]
    );
    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsOne,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 2,
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsTwo,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 3,
    };

    const TestERC721Artifact = await artifacts.readArtifact("TestERC721");
    const testERC721Iface = new ethers.Interface(TestERC721Artifact.abi);

    const firstData = testERC721Iface.encodeFunctionData("transferFrom", [
      accounts[0].address,
      accounts[6].address,
      nfts[0],
    ]);
    const secondData = testERC721Iface.encodeFunctionData("transferFrom", [
      accounts[6].address,
      accounts[0].address,
      nfts[1],
    ]);

    const firstCall = { target: erc721.target, howToCall: 0, data: firstData };
    const secondCall = {
      target: erc721.target,
      howToCall: 0,
      data: secondData,
    };
    const sigOne = NULL_SIG;

    const wrappedExchange = wrap(exchange);

    const sigTwo = await wrappedExchange.sign(two, accounts[6]);
    await wrappedExchange.atomicMatch(
      one,
      sigOne,
      firstCall,
      two,
      sigTwo,
      secondCall,
      ZERO_BYTES32
    );

    expect(await erc721.ownerOf(nfts[0]), "Incorrect owner").to.equal(
      accounts[6].address
    );
  });

  it("matches nft-nft swap order, abi-decoding instead", async () => {
    const { exchange, registry, statici } = await withContracts();
    const { nfts, erc721 } = await withAsymmetricalTokens2();

    await registry.connect(accounts[0]).registerProxy();
    const proxy1 = await registry.proxies(accounts[0].address);
    expect(proxy1.length, "no proxy address for account[0]").to.be.greaterThan(
      0
    );

    await registry.connect(accounts[6]).registerProxy();
    const proxy2 = await registry.proxies(accounts[6].address);
    expect(proxy2.length, "no proxy address for account[6]").to.be.greaterThan(
      0
    );

    await Promise.all([
      erc721.connect(accounts[0]).setApprovalForAll(proxy1, true),
      erc721.connect(accounts[6]).setApprovalForAll(proxy2, true),
    ]);

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);

    const selector = wyvernStaicIface.getFunction(
      "swapOneForOneERC721Decoding(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const paramsOne = abiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc721.target, erc721.target],
        [nfts[0], nfts[1]],
      ]
    );
    const paramsTwo = abiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc721.target, erc721.target],
        [nfts[1], nfts[0]],
      ]
    );

    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsOne,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 333123,
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsTwo,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 123344,
    };

    const TestERC721Artifact = await artifacts.readArtifact("TestERC721");
    const testERC721Iface = new ethers.Interface(TestERC721Artifact.abi);

    const firstData = testERC721Iface.encodeFunctionData("transferFrom", [
      accounts[0].address,
      accounts[6].address,
      nfts[0],
    ]);
    const secondData = testERC721Iface.encodeFunctionData("transferFrom", [
      accounts[6].address,
      accounts[0].address,
      nfts[1],
    ]);

    const firstCall = { target: erc721.target, howToCall: 0, data: firstData };
    const secondCall = {
      target: erc721.target,
      howToCall: 0,
      data: secondData,
    };
    const sigOne = NULL_SIG;

    const wrappedExchange = wrap(exchange);

    const sigTwo = await wrappedExchange.sign(two, accounts[6]);
    await wrappedExchange.atomicMatch(
      one,
      sigOne,
      firstCall,
      two,
      sigTwo,
      secondCall,
      ZERO_BYTES32
    );
    expect(await erc721.ownerOf(nfts[0]), "Incorrect owner").to.equal(
      accounts[6].address
    );
  });

  it("matches two nft + erc20 orders", async () => {
    const { atomicizer, exchange, registry, statici, erc20, erc721 } =
      await withContracts();
    const { nfts } = await withSomeTokens();

    await registry.connect(accounts[0]).registerProxy();
    const proxy1 = await registry.proxies(accounts[0].address);
    expect(proxy1.length, "no proxy address for account[0]").to.be.greaterThan(
      0
    );

    await Promise.all([
      erc20.connect(accounts[0]).approve(proxy1, 100000),
      erc721.connect(accounts[0]).setApprovalForAll(proxy1, true),
    ]);

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);

    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 2,
    };
    const two = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 3,
    };
    const sig = NULL_SIG;

    const TestERC20Artifact = await artifacts.readArtifact("TestERC20");
    const testERC20Iface = new ethers.Interface(TestERC20Artifact.abi);

    const TestERC721Artifact = await artifacts.readArtifact("TestERC721");
    const testERC721Iface = new ethers.Interface(TestERC721Artifact.abi);

    const abi = [
      {
        constant: false,
        inputs: [
          { name: "addrs", type: "address[]" },
          { name: "values", type: "uint256[]" },
          { name: "calldataLengths", type: "uint256[]" },
          { name: "calldatas", type: "bytes" },
        ],
        name: "atomicize",
        outputs: [],
        payable: false,
        stateMutability: "nonpayable",
        type: "function",
      },
    ];
    const wyvernAtomicizerIface = new ethers.Interface(abi);

    const firstERC20Call = testERC20Iface.encodeFunctionData("transferFrom", [
      accounts[0].address,
      accounts[6].address,
      2,
    ]);
    const firstERC721Call = testERC721Iface.encodeFunctionData("transferFrom", [
      accounts[0].address,
      accounts[6].address,
      nfts[0],
    ]);
    const firstData = wyvernAtomicizerIface.encodeFunctionData("atomicize", [
      [erc20.target, erc721.target],
      [0, 0],
      [(firstERC20Call.length - 2) / 2, (firstERC721Call.length - 2) / 2],
      firstERC20Call + firstERC721Call.slice(2),
    ]);

    const secondERC20Call = testERC20Iface.encodeFunctionData("transferFrom", [
      accounts[0].address,
      accounts[2].address,
      2,
    ]);
    const secondERC721Call = testERC721Iface.encodeFunctionData(
      "transferFrom",
      [accounts[0].address, accounts[2].address, nfts[1]]
    );
    const secondData = wyvernAtomicizerIface.encodeFunctionData("atomicize", [
      [erc721.target, erc20.target],
      [0, 0],
      [(secondERC721Call.length - 2) / 2, (secondERC20Call.length - 2) / 2],
      secondERC721Call + secondERC20Call.slice(2),
    ]);

    const firstCall = {
      target: atomicizer.target,
      howToCall: 1,
      data: firstData,
    };
    const secondCall = {
      target: atomicizer.target,
      howToCall: 1,
      data: secondData,
    };

    await wrap(exchange).atomicMatch(
      one,
      sig,
      firstCall,
      two,
      sig,
      secondCall,
      ZERO_BYTES32
    );

    expect(
      await erc20.balanceOf(accounts[6].address),
      "Incorrect balance"
    ).to.equal(2);
  });

  it("matches two nft + erc20 orders, real static call", async () => {
    const { atomicizer, exchange, registry, statici, erc20, erc721 } =
      await withContracts();
    const { nfts } = await withSomeTokens();

    await registry.connect(accounts[0]).registerProxy();
    const proxy1 = await registry.proxies(accounts[0].address);
    expect(proxy1.length, "no proxy address for account[0]").to.be.greaterThan(
      0
    );

    await registry.connect(accounts[6]).registerProxy();
    const proxy2 = await registry.proxies(accounts[6].address);
    expect(proxy2.length, "no proxy address for account[6]").to.be.greaterThan(
      0
    );

    await Promise.all([
      erc20.connect(accounts[0]).approve(proxy1, 100000),
      erc721.connect(accounts[0]).setApprovalForAll(proxy1, true),
      // erc20.connect(accounts[6]).approve(proxy2, 100000),
      erc721.connect(accounts[6]).setApprovalForAll(proxy2, true),
    ]);

    //We need this line for the test to pass
    //(hardhat network resets state after each test)
    await erc721.transferFrom(
      accounts[0].address,
      accounts[6].address,
      nfts[0]
    );

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);

    const selectorOne = wyvernStaicIface.getFunction(
      "split(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const selectorOneA = wyvernStaicIface.getFunction(
      "sequenceExact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;
    const selectorOneB = wyvernStaicIface.getFunction(
      "sequenceExact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;
    const firstEDSelector = wyvernStaicIface.getFunction(
      "transferERC20Exact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;
    const firstEDParams = abiCoder.encode(
      ["address", "uint256"],
      [erc20.target, "2"]
    );
    const secondEDSelector = wyvernStaicIface.getFunction(
      "transferERC721Exact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;
    const secondEDParams = abiCoder.encode(
      ["address", "uint256"],
      [erc721.target, nfts[2]]
    );
    const extradataOneA = abiCoder.encode(
      ["address[]", "uint256[]", "bytes4[]", "bytes"],
      [
        [statici.target, statici.target],
        [(firstEDParams.length - 2) / 2, (secondEDParams.length - 2) / 2],
        [firstEDSelector, secondEDSelector],
        firstEDParams + secondEDParams.slice(2),
      ]
    );
    const bEDParams = abiCoder.encode(
      ["address", "uint256"],
      [erc721.target, nfts[0]]
    );
    const bEDSelector = wyvernStaicIface.getFunction(
      "transferERC721Exact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;
    const extradataOneB = abiCoder.encode(
      ["address[]", "uint256[]", "bytes4[]", "bytes"],
      [[statici.target], [(bEDParams.length - 2) / 2], [bEDSelector], bEDParams]
    );
    const paramsOneA = abiCoder.encode(
      ["address[2]", "bytes4[2]", "bytes", "bytes"],
      [
        [statici.target, statici.target],
        [selectorOneA, selectorOneB],
        extradataOneA,
        extradataOneB,
      ]
    );
    const extradataOne = paramsOneA;
    const selectorTwo = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;
    const extradataTwo = "0x";
    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selectorOne,
      staticExtradata: extradataOne,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 3352,
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selectorTwo,
      staticExtradata: extradataTwo,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 3335,
    };
    const sig = NULL_SIG;

    const TestERC20Artifact = await artifacts.readArtifact("TestERC20");
    const testERC20Iface = new ethers.Interface(TestERC20Artifact.abi);

    const TestERC721Artifact = await artifacts.readArtifact("TestERC721");
    const testERC721Iface = new ethers.Interface(TestERC721Artifact.abi);

    const abi = [
      {
        constant: false,
        inputs: [
          { name: "addrs", type: "address[]" },
          { name: "values", type: "uint256[]" },
          { name: "calldataLengths", type: "uint256[]" },
          { name: "calldatas", type: "bytes" },
        ],
        name: "atomicize",
        outputs: [],
        payable: false,
        stateMutability: "nonpayable",
        type: "function",
      },
    ];
    const wyvernAtomicizerIface = new ethers.Interface(abi);

    const firstERC20Call = testERC20Iface.encodeFunctionData("transferFrom", [
      accounts[0].address,
      accounts[6].address,
      2,
    ]);
    const firstERC721Call = testERC721Iface.encodeFunctionData("transferFrom", [
      accounts[0].address,
      accounts[6].address,
      nfts[2],
    ]);
    const firstData = wyvernAtomicizerIface.encodeFunctionData("atomicize", [
      [erc20.target, erc721.target],
      [0, 0],
      [(firstERC20Call.length - 2) / 2, (firstERC721Call.length - 2) / 2],
      firstERC20Call + firstERC721Call.slice(2),
    ]);

    const secondERC721Call = testERC721Iface.encodeFunctionData(
      "transferFrom",
      [accounts[6].address, accounts[0].address, nfts[0]]
    );
    const secondData = wyvernAtomicizerIface.encodeFunctionData("atomicize", [
      [erc721.target],
      [0],
      [(secondERC721Call.length - 2) / 2],
      secondERC721Call,
    ]);

    const firstCall = {
      target: atomicizer.target,
      howToCall: 1,
      data: firstData,
    };
    const secondCall = {
      target: atomicizer.target,
      howToCall: 1,
      data: secondData,
    };

    const wrappedExchange = wrap(exchange);

    const twoSig = await wrappedExchange.sign(two, accounts[6]);
    await wrappedExchange.atomicMatch(
      one,
      sig,
      firstCall,
      two,
      twoSig,
      secondCall,
      ZERO_BYTES32
    );
    expect(
      await erc20.balanceOf(accounts[6].address),
      "Incorrect balance"
    ).to.equal(2);
  });

  it("matches erc20-erc20 swap order", async () => {
    const { exchange, registry, statici } = await withContracts();
    const { erc20 } = await withTokens();

    await registry.connect(accounts[0]).registerProxy();
    const proxy1 = await registry.proxies(accounts[0].address);
    expect(proxy1.length, "no proxy address for account[0]").to.be.greaterThan(
      0
    );

    await registry.connect(accounts[6]).registerProxy();
    const proxy2 = await registry.proxies(accounts[6].address);
    expect(proxy2.length, "no proxy address for account[6]").to.be.greaterThan(
      0
    );

    await Promise.all([
      erc20.connect(accounts[0]).approve(proxy1, 100000),
      erc20.connect(accounts[6]).approve(proxy2, 100000),
    ]);

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "swapExact(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const paramsOne = abiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc20.target, erc20.target],
        ["1", "2"],
      ]
    );
    const paramsTwo = abiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc20.target, erc20.target],
        ["2", "1"],
      ]
    );

    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsOne,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 412312,
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsTwo,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 4434,
    };

    const TestERC20Artifact = await artifacts.readArtifact("TestERC20");
    const testERC20Iface = new ethers.Interface(TestERC20Artifact.abi);

    const firstData = testERC20Iface.encodeFunctionData("transferFrom", [
      accounts[0].address,
      accounts[6].address,
      1,
    ]);
    const secondData = testERC20Iface.encodeFunctionData("transferFrom", [
      accounts[6].address,
      accounts[0].address,
      2,
    ]);

    const firstCall = { target: erc20.target, howToCall: 0, data: firstData };
    const secondCall = {
      target: erc20.target,
      howToCall: 0,
      data: secondData,
    };
    const sigOne = NULL_SIG;

    const wrappedExchange = wrap(exchange);

    const sigTwo = await wrappedExchange.sign(two, accounts[6]);
    await wrappedExchange.atomicMatch(
      one,
      sigOne,
      firstCall,
      two,
      sigTwo,
      secondCall,
      ZERO_BYTES32
    );
    //TODO: missing assertion
  });

  it("matches with signatures", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 2344,
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 2345,
    };

    const wrappedExchange = wrap(exchange);

    const [oneSig, twoSig] = await Promise.all([
      wrappedExchange.sign(one, accounts[6]),
      wrappedExchange.sign(two, accounts[6]),
    ]);
    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };
    expect(
      await wrappedExchange.atomicMatch(
        one,
        oneSig,
        call,
        two,
        twoSig,
        call,
        ZERO_BYTES32
      )
    ).to.be.ok;
  });

  it("should not match with signatures twice", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 2344,
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 2345,
    };

    const wrappedExchange = wrap(exchange);

    const [oneSig, twoSig] = await Promise.all([
      wrappedExchange.sign(one, accounts[6]),
      wrappedExchange.sign(two, accounts[6]),
    ]);

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    // Notice: this line was not available for the original test
    // but it's now needed for the test to pass
    // (might be because of how hardhat network works)
    await wrappedExchange.atomicMatch(
      one,
      oneSig,
      call,
      two,
      twoSig,
      call,
      ZERO_BYTES32
    );
    return await expect(
      wrappedExchange.atomicMatch(
        one,
        oneSig,
        call,
        two,
        twoSig,
        call,
        ZERO_BYTES32
      ),
      "Should not have matched twice"
    ).to.be.revertedWith(/First order has invalid parameters/);
  });

  it("matches with signatures no-fill", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "anyNoFill(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange);

    const [oneSig, twoSig] = await Promise.all([
      wrappedExchange.sign(one, accounts[6]),
      wrappedExchange.sign(two, accounts[6]),
    ]);

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    expect(
      await wrappedExchange.atomicMatch(
        one,
        oneSig,
        call,
        two,
        twoSig,
        call,
        ZERO_BYTES32
      )
    ).to.be.ok;
  });

  it("should match with signatures no-fill, value", async () => {
    const { exchange, registry, statici } = await withContracts();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "anyNoFill(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange);

    const [oneSig, twoSig] = await Promise.all([
      wrappedExchange.sign(one, accounts[6]),
      wrappedExchange.sign(two, accounts[6]),
    ]);

    const call = {
      target: statici.address,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    expect(
      wrappedExchange.atomicMatchWith(
        one,
        oneSig,
        call,
        two,
        twoSig,
        call,
        ZERO_BYTES32,
        { value: 3 }
      )
    ).to.be.ok;
  });

  it("should match with approvals", async () => {
    const { exchange, registry, statici } = await withContracts();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange.connect(accounts[6]));

    await Promise.all([
      wrappedExchange.approveOrder(one, false),
      wrappedExchange.approveOrder(two, false),
    ]);
    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    expect(
      wrap(exchange).atomicMatch(
        one,
        NULL_SIG,
        call,
        two,
        NULL_SIG,
        call,
        ZERO_BYTES32
      )
    ).to.be.ok;
  });

  it("does not match with invalid first order auth", async () => {
    const { exchange, registry, statici } = await withContracts();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange);

    const signature = await wrappedExchange.sign(one, accounts[6]);
    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    return await expect(
      wrappedExchange.atomicMatch(
        one,
        NULL_SIG,
        call,
        two,
        signature,
        call,
        ZERO_BYTES32
      ),
      "Should not have matched"
    ).to.be.revertedWith(/First order failed authorization/);
  });

  it("does not match with invalid second order auth", async () => {
    const { exchange, registry, statici } = await withContracts();
    // await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange);

    const signature = await wrappedExchange.sign(one, accounts[6]);
    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };
    return await expect(
      wrappedExchange.atomicMatch(
        one,
        signature,
        call,
        two,
        NULL_SIG,
        call,
        ZERO_BYTES32
      ),
      "Should not have matched"
    ).to.be.revertedWith(/Second order failed authorization/);
  });

  it("does not match with invalid first order params", async () => {
    const { exchange, registry, statici } = await withContracts();
    // await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange.connect(accounts[6]));

    await wrappedExchange.inst.setOrderFill_(hashOrder(one), "10");

    const [oneSig, twoSig] = await Promise.all([
      wrap(exchange).sign(one, accounts[6]),
      wrap(exchange).sign(two, accounts[6]),
    ]);

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    return await expect(
      wrap(exchange).atomicMatch(
        one,
        oneSig,
        call,
        two,
        twoSig,
        call,
        ZERO_BYTES32
      ),
      "Should not have matched"
    ).to.be.revertedWith(/First order has invalid parameters/);
  });

  it("does not match with invalid second order params", async () => {
    const { exchange, registry, statici } = await withContracts();

    // await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange.connect(accounts[6]));

    await wrappedExchange.inst.setOrderFill_(hashOrder(two), "3");

    const [oneSig, twoSig] = await Promise.all([
      wrap(exchange).sign(one, accounts[6]),
      wrap(exchange).sign(two, accounts[6]),
    ]);

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    return await expect(
      wrap(exchange).atomicMatch(
        one,
        oneSig,
        call,
        two,
        twoSig,
        call,
        ZERO_BYTES32
      ),
      "Should not have matched"
    ).to.be.revertedWith(/Second order has invalid parameters/);
  });

  it("does not match with nonexistent first proxy", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");
    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[7].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange);

    const [oneSig, twoSig] = await Promise.all([
      wrappedExchange.sign(one, accounts[7]),
      wrappedExchange.sign(two, accounts[7]),
    ]);

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    return await expect(
      wrappedExchange.atomicMatch(
        one,
        oneSig,
        call,
        two,
        twoSig,
        call,
        ZERO_BYTES32
      ),
      "Should not have matched"
    ).to.be.revertedWith(/Second order failed authorization/);
  });

  it("does not match with nonexistent second proxy", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[7].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange);

    const [oneSig, twoSig] = await Promise.all([
      wrappedExchange.sign(one, accounts[6]),
      wrappedExchange.sign(two, accounts[6]),
    ]);

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };
    return await expect(
      wrappedExchange.atomicMatch(
        one,
        oneSig,
        call,
        two,
        twoSig,
        call,
        ZERO_BYTES32
      ),
      "Should not have matched"
    ).to.be.revertedWith(/Second order failed authorization/);
  });

  it("should not match with nonexistent target", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange);

    const [oneSig, twoSig] = await Promise.all([
      wrappedExchange.sign(one, accounts[6]),
      wrappedExchange.sign(two, accounts[6]),
    ]);

    const call = {
      target: accounts[7].address,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    return await expect(
      wrappedExchange.atomicMatch(
        one,
        oneSig,
        call,
        two,
        twoSig,
        call,
        ZERO_BYTES32
      ),
      "Should not have matched"
    ).to.be.revertedWith(/Call target does not exist/);
  });

  it("should allow value transfer", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange);

    const [oneSig, twoSig] = await Promise.all([
      wrappedExchange.sign(one, accounts[6]),
      wrappedExchange.sign(two, accounts[6]),
    ]);

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    expect(
      await wrappedExchange.atomicMatchWith(
        one,
        oneSig,
        call,
        two,
        twoSig,
        call,
        ZERO_BYTES32,
        { value: 200 }
      )
    ).to.be.ok;
  });

  it("allows proxy registration for smart contract", async () => {
    let { registry, erc721, smartContractWallet } = await withContracts();
    // this registration carries over to the following test and is necessary for the value exchange.
    await smartContractWallet
      .connect(accounts[6])
      .registerProxy(registry.target);

    const proxy = await registry.proxies(smartContractWallet.target);

    expect(proxy.length, "No proxy address").to.be.greaterThan(0);
    expect(
      await smartContractWallet
        .connect(accounts[6])
        .setApprovalForAll(proxy, erc721.target, true)
    ).to.be.ok;
  });

  it("should match with approvals and value to contract", async () => {
    const value = 200;
    const { exchange, registry, statici, smartContractWallet } =
      await withContracts();

    // await registry.registerProxyFor(smartContractWallet.target);
    await smartContractWallet
      .connect(accounts[6])
      .registerProxy(registry.target);
    await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };
    const two = {
      registry: registry.target,
      maker: smartContractWallet.target,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: randomUint(),
    };

    const wrappedExchange = wrap(exchange.connect(accounts[6]));

    await Promise.all([
      wrappedExchange.approveOrder(one, false),
      smartContractWallet
        .connect(accounts[6])
        .approveOrder_(
          exchange.target,
          two.registry,
          two.maker,
          two.staticTarget,
          two.staticSelector,
          two.staticExtradata,
          two.maximumFill,
          two.listingTime,
          two.expirationTime,
          two.salt,
          false
        ),
    ]);

    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    expect(
      await wrappedExchange.atomicMatchWith(
        two,
        NULL_SIG,
        call,
        one,
        NULL_SIG,
        call,
        ZERO_BYTES32,
        { value: value, from: accounts[6].address }
      )
    ).to.be.ok;
    expect(
      await ethers.provider.getBalance(smartContractWallet.target)
    ).to.equal(value);
  });

  it("matches orders signed with personal_sign", async () => {
    const { exchange, registry, statici } = await withContracts();

    await registry.connect(accounts[0]).registerProxy();
    await registry.connect(accounts[6]).registerProxy();

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaicIface = new ethers.Interface(WyvernStaticArtifact.abi);
    const selector = wyvernStaicIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const one = {
      registry: registry.target,
      maker: accounts[0].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 0,
    };
    const two = {
      registry: registry.target,
      maker: accounts[6].address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: "0x",
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 100000000000,
      salt: 1,
    };
    const call = {
      target: statici.target,
      howToCall: 0,
      data: wyvernStaicIface.getFunction("test()")!.selector,
    };

    const wrappedExchange = wrap(exchange);
    const wrappedExchangeOther = wrap(exchange.connect(accounts[5]));

    const sigOne = await wrappedExchange.personalSign(one, accounts[0]);
    const sigTwo = await wrappedExchange.personalSign(two, accounts[6]);

    expect(
      await wrappedExchangeOther.atomicMatchWith(
        one,
        sigOne,
        call,
        two,
        sigTwo,
        call,
        ZERO_BYTES32,
        { from: accounts[5] }
      )
    ).to.be.ok;
  });
});
