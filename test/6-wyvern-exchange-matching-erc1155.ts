import { artifacts } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { ethers } from "hardhat";
import { expect } from "chai";

import { wrap, ZERO_BYTES32, CHAIN_ID, NULL_SIG } from "./util";

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
      ethers.deployContract("WyvernStatic", [atomicizer.target]),
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

  it("matches erc1155 nft-nft swap order", async () => {
    const account_a = accounts[0];
    const account_b = accounts[6];

    const { exchange, registry, statici } = await loadFixture(
      deployCoreContractsFixture
    );
    const erc1155 = await loadFixture(deployTestERC1155Fixture);

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
      erc1155.connect(account_b).setApprovalForAll(proxy2, true),
    ]);

    const nfts = [
      { tokenId: 4, amount: 1 },
      { tokenId: 5, amount: 1 },
    ];

    await Promise.all([
      erc1155.mint(account_a.address, nfts[0].tokenId),
      erc1155.mint(account_b.address, nfts[1].tokenId),
    ]);

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaticIface = new ethers.Interface(WyvernStaticArtifact.abi);

    const selector = wyvernStaticIface.getFunction(
      "swapOneForOneERC1155(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const paramsOne = abiCoder.encode(
      ["address[2]", "uint256[2]", "uint256[2]"],
      [
        [erc1155.target, erc1155.target],
        [nfts[0].tokenId, nfts[1].tokenId],
        [nfts[0].amount, nfts[1].amount],
      ]
    );

    const paramsTwo = abiCoder.encode(
      ["address[2]", "uint256[2]", "uint256[2]"],
      [
        [erc1155.target, erc1155.target],
        [nfts[1].tokenId, nfts[0].tokenId],
        [nfts[1].amount, nfts[0].amount],
      ]
    );

    const one = {
      registry: registry.target,
      maker: account_a.address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsOne,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 7,
    };
    const two = {
      registry: registry.target,
      maker: account_b.address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsTwo,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 8,
    };

    const TestERC1155Artifact = await artifacts.readArtifact("TestERC1155");

    const erc1155Iface = new ethers.Interface(TestERC1155Artifact.abi);

    const firstData =
      erc1155Iface.encodeFunctionData("safeTransferFrom", [
        account_a.address,
        account_b.address,
        nfts[0].tokenId,
        nfts[0].amount,
        "0x",
      ]) + ZERO_BYTES32.substr(2);

    const secondData =
      erc1155Iface.encodeFunctionData("safeTransferFrom", [
        account_b.address,
        account_a.address,
        nfts[1].tokenId,
        nfts[1].amount,
        "0x",
      ]) + ZERO_BYTES32.substr(2);

    const firstCall = {
      target: erc1155.target,
      howToCall: 0,
      data: firstData,
    };
    const secondCall = {
      target: erc1155.target,
      howToCall: 0,
      data: secondData,
    };

    const wrappedExchange = wrap(exchange);

    const sigOne = NULL_SIG;
    const sigTwo = await wrappedExchange.sign(two, account_b);

    await wrappedExchange.atomicMatch(
      one,
      sigOne,
      firstCall,
      two,
      sigTwo,
      secondCall,
      ZERO_BYTES32
    );

    const [new_balance1, new_balance2] = await Promise.all([
      erc1155.balanceOf(account_a.address, nfts[1].tokenId),
      erc1155.balanceOf(account_b.address, nfts[0].tokenId),
    ]);

    expect(new_balance1, "Incorrect owner").to.be.greaterThan(0);
    expect(new_balance2, "Incorrect owner").to.be.greaterThan(0);
  });

  it("matches nft-nft swap order, abi-decoding instead", async () => {
    const account_a = accounts[0];
    const account_b = accounts[6];

    const { exchange, registry, statici } = await loadFixture(
      deployCoreContractsFixture
    );
    const erc1155 = await loadFixture(deployTestERC1155Fixture);

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
      erc1155.connect(account_b).setApprovalForAll(proxy2, true),
    ]);

    const nfts = [
      { tokenId: 4, amount: 1 },
      { tokenId: 5, amount: 1 },
    ];

    await Promise.all([
      erc1155.mint(account_a.address, nfts[0].tokenId),
      erc1155.mint(account_b.address, nfts[1].tokenId),
    ]);

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaticIface = new ethers.Interface(WyvernStaticArtifact.abi);

    const selector = wyvernStaticIface.getFunction(
      "swapOneForOneERC1155Decoding(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const paramsOne = abiCoder.encode(
      ["address[2]", "uint256[2]", "uint256[2]"],
      [
        [erc1155.target, erc1155.target],
        [nfts[0].tokenId, nfts[1].tokenId],
        [nfts[0].amount, nfts[1].amount],
      ]
    );

    const paramsTwo = abiCoder.encode(
      ["address[2]", "uint256[2]", "uint256[2]"],
      [
        [erc1155.target, erc1155.target],
        [nfts[1].tokenId, nfts[0].tokenId],
        [nfts[1].amount, nfts[0].amount],
      ]
    );

    const one = {
      registry: registry.target,
      maker: account_a.address,
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
      maker: account_b.address,
      staticTarget: statici.target,
      staticSelector: selector,
      staticExtradata: paramsTwo,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 123344,
    };

    const TestERC1155Artifact = await artifacts.readArtifact("TestERC1155");

    const erc1155Iface = new ethers.Interface(TestERC1155Artifact.abi);

    const firstData =
      erc1155Iface.encodeFunctionData("safeTransferFrom", [
        account_a.address,
        account_b.address,
        nfts[0].tokenId,
        nfts[0].amount,
        "0x",
      ]) + ZERO_BYTES32.substr(2);

    const secondData =
      erc1155Iface.encodeFunctionData("safeTransferFrom", [
        account_b.address,
        account_a.address,
        nfts[1].tokenId,
        nfts[1].amount,
        "0x",
      ]) + ZERO_BYTES32.substr(2);

    const firstCall = {
      target: erc1155.target,
      howToCall: 0,
      data: firstData,
    };
    const secondCall = {
      target: erc1155.target,
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

    const [new_balance1, new_balance2] = await Promise.all([
      erc1155.balanceOf(account_a.address, nfts[1].tokenId),
      erc1155.balanceOf(account_b.address, nfts[0].tokenId),
    ]);

    expect(new_balance1, "Incorrect balance").to.be.greaterThan(0);
    expect(new_balance2, "Incorrect balance").to.be.greaterThan(0);
  });

  it("matches erc1155 + erc20 <> erc1155 orders, matched left, real static call", async () => {
    const account_a = accounts[0];
    const account_b = accounts[6];

    const price = 10000;
    const tokenId = 4;

    const { atomicizer, exchange, registry, statici } = await loadFixture(
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
      erc20.connect(account_a).approve(proxy1, price),
      erc1155.connect(account_a).setApprovalForAll(proxy1, true),
      erc1155.connect(account_b).setApprovalForAll(proxy2, true),
    ]);
    await Promise.all([
      erc20.mint(account_a.address, price),
      erc1155["mint(address,uint256,uint256)"](account_a.address, tokenId, 1),
      erc1155["mint(address,uint256,uint256)"](account_b.address, tokenId, 1),
    ]);

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaticIface = new ethers.Interface(WyvernStaticArtifact.abi);

    const selectorOne = wyvernStaticIface.getFunction(
      "split(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const selectorOneA = wyvernStaticIface.getFunction(
      "sequenceExact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;

    const selectorOneB = wyvernStaticIface.getFunction(
      "sequenceExact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;

    const firstEDSelector = wyvernStaticIface.getFunction(
      "transferERC20Exact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;

    const firstEDParams = abiCoder.encode(
      ["address", "uint256"],
      [erc20.target, price]
    );

    const secondEDSelector = wyvernStaticIface.getFunction(
      "transferERC1155Exact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;

    const secondEDParams = abiCoder.encode(
      ["address", "uint256", "uint256"],
      [erc1155.target, tokenId, 1]
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
      ["address", "uint256", "uint256"],
      [erc1155.target, tokenId, 1]
    );

    const bEDSelector = wyvernStaticIface.getFunction(
      "transferERC1155Exact(bytes,address[7],uint8,uint256[6],bytes)"
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
    const selectorTwo = wyvernStaticIface.getFunction(
      "any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const extradataTwo = "0x";
    const one = {
      registry: registry.target,
      maker: account_a.address,
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
      maker: account_b.address,
      staticTarget: statici.target,
      staticSelector: selectorTwo,
      staticExtradata: extradataTwo,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 3335,
    };

    const sig = NULL_SIG;

    const TestERC1155Artifact = await artifacts.readArtifact("TestERC1155");
    const TestERC20Artifact = await artifacts.readArtifact("TestERC20");
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

    const erc1155Iface = new ethers.Interface(TestERC1155Artifact.abi);
    const erc20Iface = new ethers.Interface(TestERC20Artifact.abi);
    const wyvernAtomicizerIface = new ethers.Interface(abi);

    const firstERC20Call = erc20Iface.encodeFunctionData("transferFrom", [
      account_a.address,
      account_b.address,
      price,
    ]);

    const firstERC1155Call =
      erc1155Iface.encodeFunctionData("safeTransferFrom", [
        account_a.address,
        account_b.address,
        tokenId,
        1,
        "0x",
      ]) + ZERO_BYTES32.substr(2);

    const firstData = wyvernAtomicizerIface.encodeFunctionData("atomicize", [
      [erc20.target, erc1155.target],
      [0, 0],
      [(firstERC20Call.length - 2) / 2, (firstERC1155Call.length - 2) / 2],
      firstERC20Call + firstERC1155Call.slice(2),
    ]);

    const secondERC1155Call =
      erc1155Iface.encodeFunctionData("safeTransferFrom", [
        account_b.address,
        account_a.address,
        tokenId,
        1,
        "0x",
      ]) + ZERO_BYTES32.substr(2);
    const secondData = wyvernAtomicizerIface.encodeFunctionData("atomicize", [
      [erc1155.target],
      [0],
      [(secondERC1155Call.length - 2) / 2],
      secondERC1155Call,
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

    const twoSig = await wrappedExchange.sign(two, account_b);
    await wrappedExchange.atomicMatch(
      one,
      sig,
      firstCall,
      two,
      twoSig,
      secondCall,
      ZERO_BYTES32
    );
    const [new_balance1, new_balance2] = await Promise.all([
      erc1155.balanceOf(account_a.address, tokenId),
      erc1155.balanceOf(account_b.address, tokenId),
    ]);

    expect(new_balance1, "Incorrect balance").to.be.greaterThan(0);
    expect(new_balance2, "Incorrect balance").to.be.greaterThan(0);
    expect(await erc20.balanceOf(account_b), "Incorrect balance").to.equal(
      price
    );
  });

  const erc1155_erc20_match_right_static_call = async (
    maximumFill: number,
    fillCount: number
  ) => {
    const account_a = accounts[0];
    const account_b = accounts[6];

    const price = 10000;
    const tokenId = 4;

    if (!maximumFill) maximumFill = 1;

    if (!fillCount) fillCount = 1;

    const { atomicizer, exchange, registry, statici } = await loadFixture(
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
      erc20.connect(account_a).approve(proxy1, price * maximumFill),
      erc1155.connect(account_b).setApprovalForAll(proxy2, true),
    ]);
    await Promise.all([
      erc20.mint(account_a.address, price * maximumFill),
      erc1155["mint(address,uint256,uint256)"](
        account_b.address,
        tokenId,
        maximumFill
      ),
    ]);

    const WyvernStaticArtifact = await artifacts.readArtifact("WyvernStatic");

    const wyvernStaticIface = new ethers.Interface(WyvernStaticArtifact.abi);

    const selectorOne = wyvernStaticIface.getFunction(
      "splitAddOne(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;

    const selectorOneA = wyvernStaticIface.getFunction(
      "sequenceExact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;

    const selectorOneB = wyvernStaticIface.getFunction(
      "sequenceExact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;

    const aEDParams = abiCoder.encode(
      ["address", "uint256"],
      [erc20.target, price]
    );

    const aEDSelector = wyvernStaticIface.getFunction(
      "transferERC20Exact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;

    // selectorOneA sequenceExact
    const extradataOneA = abiCoder.encode(
      ["address[]", "uint256[]", "bytes4[]", "bytes"],
      [[statici.target], [(aEDParams.length - 2) / 2], [aEDSelector], aEDParams]
    );

    const bEDParams = abiCoder.encode(
      ["address", "uint256", "uint256"],
      [erc1155.target, tokenId, 1]
    );
    const bEDSelector = wyvernStaticIface.getFunction(
      "transferERC1155Exact(bytes,address[7],uint8,uint256[6],bytes)"
    )!.selector;

    // selectorOneB sequenceExact
    const extradataOneB = abiCoder.encode(
      ["address[]", "uint256[]", "bytes4[]", "bytes"],
      [[statici.target], [(bEDParams.length - 2) / 2], [bEDSelector], bEDParams]
    );

    // SelectorOne split
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
    const selectorTwo = wyvernStaticIface.getFunction(
      "anyAddOne(bytes,address[7],uint8[2],uint256[6],bytes,bytes)"
    )!.selector;
    const extradataTwo = "0x";
    const one = {
      registry: registry.target,
      maker: account_a.address,
      staticTarget: statici.target,
      staticSelector: selectorOne,
      staticExtradata: extradataOne,
      maximumFill: 2,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 3358,
    };
    const two = {
      registry: registry.target,
      maker: account_b.address,
      staticTarget: statici.target,
      staticSelector: selectorTwo,
      staticExtradata: extradataTwo,
      maximumFill: 1,
      listingTime: 0,
      expirationTime: 10000000000,
      salt: 3339,
    };
    //const twob = {registry: registry.address, maker: account_b, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: extradataTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3340'}
    const wrappedExchange = wrap(exchange);
    const sig = await wrappedExchange.sign(one, account_a);

    const TestERC1155Artifact = await artifacts.readArtifact("TestERC1155");
    const TestERC20Artifact = await artifacts.readArtifact("TestERC20");
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

    const erc1155Iface = new ethers.Interface(TestERC1155Artifact.abi);
    const erc20Iface = new ethers.Interface(TestERC20Artifact.abi);
    const wyvernAtomicizerIface = new ethers.Interface(abi);

    const firstERC20Call = erc20Iface.encodeFunctionData("transferFrom", [
      account_a.address,
      account_b.address,
      price,
    ]);
    const firstData = wyvernAtomicizerIface.encodeFunctionData("atomicize", [
      [erc20.target],
      [0],
      [(firstERC20Call.length - 2) / 2],
      firstERC20Call,
    ]);

    const secondERC1155Call =
      erc1155Iface.encodeFunctionData("safeTransferFrom", [
        account_b.address,
        account_a.address,
        tokenId,
        1,
        "0x",
      ]) + ZERO_BYTES32.substr(2);
    const secondData = wyvernAtomicizerIface.encodeFunctionData("atomicize", [
      [erc1155.target],
      [0],
      [(secondERC1155Call.length - 2) / 2],
      secondERC1155Call,
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

    let twoSig = NULL_SIG;

    for (let i = 0; i < fillCount; ++i)
      await wrap(exchange.connect(account_b)).atomicMatchWith(
        one,
        sig,
        firstCall,
        two,
        twoSig,
        secondCall,
        ZERO_BYTES32
      );

    const new_balance = await erc1155.balanceOf(account_a.address, tokenId);
    expect(new_balance, "Incorrect balance").to.be.greaterThan(0);
    expect(await erc20.balanceOf(account_b), "Incorrect balance").to.equal(
      price * fillCount
    );
  };

  it("matches erc1155 <> erc20 signed orders, matched right, real static call", async () => {
    return erc1155_erc20_match_right_static_call(1, 1);
  });

  it("matches erc1155 <> erc20 signed orders, matched right, real static call, multiple fills", async () => {
    return erc1155_erc20_match_right_static_call(2, 2);
  });

  it("matches erc1155 <> erc20 signed orders, matched right, real static call, cannot fill beyond maximumFill", async () => {
    return await expect(
      erc1155_erc20_match_right_static_call(1, 2),
      "Order should not match a second time."
    ).to.be.revertedWith(/First call failed/);
  });
});
