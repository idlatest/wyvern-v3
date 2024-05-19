import { artifacts } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { expect } from "chai";

describe("WyvernRegistry", () => {
  let accounts: HardhatEthersSigner[];

  before(async function () {
    accounts = await ethers.getSigners();
  });

  const deployWyvernRegistryFixture = async () => {
    return await ethers.deployContract("WyvernRegistry");
  };

  const deployTestERC20Fixture = async () => {
    return await ethers.deployContract("TestERC20");
  };

  const deployTestAuthenticatedProxyFixture = async () => {
    return await ethers.deployContract("TestAuthenticatedProxy");
  };

  it("is deployed", async () => {
    return await ethers.deployContract("WyvernRegistry");
  });

  it("does not allow additional grant", async () => {
    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.grantInitialAuthentication(registry.target);

    await expect(
      registry.grantInitialAuthentication(registry.target),
      "Should not have allowed additional grant"
    ).to.be.revertedWith(
      /Wyvern Protocol Proxy Registry initial address already set/
    );
  });

  it("has a delegateproxyimpl", async () => {
    const registry = await loadFixture(deployWyvernRegistryFixture);
    const delegateproxyimpl = await registry.delegateProxyImplementation();

    expect(delegateproxyimpl.length, "delegateproxyimpl was not set").to.eq(42);
  });

  it("allows proxy registration", async () => {
    const account = accounts[3];

    const registry = await loadFixture(deployWyvernRegistryFixture);
    await registry.connect(account).registerProxy();
    const proxy = await registry.proxies(account.address);

    expect(proxy.length).to.be.greaterThan(0);
  });

  it("allows proxy registration", async () => {
    const account = accounts[2];

    const registry = await loadFixture(deployWyvernRegistryFixture);
    await registry.connect(account).registerProxy();
    const proxy = await registry.proxies(account.address);

    expect(proxy.length).to.be.greaterThan(0);
  });

  it("allows proxy override", async () => {
    const account = accounts[2];

    const registry = await loadFixture(deployWyvernRegistryFixture);
    await registry.connect(account).registerProxyOverride();
    const proxy = await registry.proxies(account.address);

    expect(proxy.length).to.be.greaterThan(0);
  });

  it("allows proxy upgrade", async () => {
    const account = accounts[5];

    const registry = await loadFixture(deployWyvernRegistryFixture);
    await registry.connect(account).registerProxy();
    const proxy = await registry.proxies(account.address);

    const OwnableDelegateProxyArtifact = await artifacts.readArtifact(
      "OwnableDelegateProxy"
    );
    const contract = new ethers.Contract(
      proxy,
      OwnableDelegateProxyArtifact.abi
    );

    const implementation = await registry.delegateProxyImplementation();

    expect(await contract.connect(account).upgradeTo(registry.target)).to.be.ok;
    expect(await contract.connect(account).upgradeTo(implementation)).to.be.ok;
  });

  it("allows proxy to receive ether", async () => {
    const registry = await loadFixture(deployWyvernRegistryFixture);
    const proxy = await registry.proxies(accounts[3].address);

    expect(
      await accounts[0].sendTransaction({
        to: proxy,
        value: 1000,
      })
    ).to.be.ok;
  });

  it("allows proxy to receive tokens before approval", async () => {
    const account = accounts[3];
    const amount = "1000";

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.connect(account).registerProxy();

    const proxy = await registry.proxies(account.address);
    const erc20 = await loadFixture(deployTestERC20Fixture);

    const AuthenticatedProxyArtifact = await artifacts.readArtifact(
      "AuthenticatedProxy"
    );
    const contract = new ethers.Contract(proxy, AuthenticatedProxyArtifact.abi);

    await expect(
      contract
        .connect(account)
        .receiveApproval(account.address, amount, erc20.target, "0x"),
      "Should not have succeeded"
    ).to.be.revertedWith(/ERC20: transfer amount exceeds balance/);
  });

  it("allows proxy to receive tokens", async () => {
    const account = accounts[3];
    const amount = "1000";

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.connect(account).registerProxy();

    const proxy = await registry.proxies(account.address);
    const erc20 = await loadFixture(deployTestERC20Fixture);

    await Promise.all([
      erc20.mint(account.address, amount),
      erc20.connect(account).approve(proxy, amount),
    ]);

    const AuthenticatedProxyArtifact = await artifacts.readArtifact(
      "AuthenticatedProxy"
    );
    const contract = new ethers.Contract(proxy, AuthenticatedProxyArtifact.abi);

    expect(
      contract
        .connect(account)
        .receiveApproval(account.address, amount, erc20.target, "0x")
    ).to.be.ok;
  });

  it("does not allow proxy upgrade to same implementation", async () => {
    const account = accounts[3];

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.connect(account).registerProxy();

    const proxy = await registry.proxies(account.address);
    const implementation = await registry.delegateProxyImplementation();
    const OwnableDelegateProxyArtifact = await artifacts.readArtifact(
      "OwnableDelegateProxy"
    );
    const contract = new ethers.Contract(
      proxy,
      OwnableDelegateProxyArtifact.abi
    );

    await expect(
      contract.connect(account).upgradeTo(implementation),
      "Allowed upgrade to same implementation"
    ).to.be.revertedWith(/Proxy already uses this implementation/);
  });

  it("returns proxy type", async () => {
    const account = accounts[3];

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.connect(account).registerProxy();

    const proxy = await registry.proxies(account.address);
    const OwnableDelegateProxyArtifact = await artifacts.readArtifact(
      "OwnableDelegateProxy"
    );
    const contract = new ethers.Contract(
      proxy,
      OwnableDelegateProxyArtifact.abi,
      accounts[0]
    );

    expect(await contract.proxyType(), "Incorrect proxy type").equal(2);
  });

  it("does not allow proxy update from another account", async () => {
    const account = accounts[3];

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.connect(account).registerProxy();

    const proxy = await registry.proxies(accounts[3].address);
    const OwnableDelegateProxyArtifact = await artifacts.readArtifact(
      "OwnableDelegateProxy"
    );
    const contract = new ethers.Contract(
      proxy,
      OwnableDelegateProxyArtifact.abi
    );

    await expect(
      contract.connect(accounts[1]).upgradeTo(registry.target),
      "Allowed proxy update from another account"
    ).to.be.revertedWith(/Only the proxy owner can call this method/);
  });

  it("allows proxy ownership transfer", async () => {
    const account = accounts[3];

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.connect(account).registerProxy();

    const proxy = await registry.proxies(account.address);

    const OwnableDelegateProxyArtifact = await artifacts.readArtifact(
      "OwnableDelegateProxy"
    );
    const contract = new ethers.Contract(
      proxy,
      OwnableDelegateProxyArtifact.abi
    );

    expect(
      await contract
        .connect(account)
        .transferProxyOwnership(accounts[4].address)
    ).to.be.ok;
    expect(
      await contract
        .connect(accounts[4])
        .transferProxyOwnership(account.address)
    ).to.be.ok;
  });

  it("allows start but not end of authentication process", async () => {
    const account = accounts[0];

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.startGrantAuthentication(account.address);

    const timestamp = await registry.pending(account.address);
    expect(timestamp, "Invalid timestamp").to.be.greaterThan(0);
    await expect(
      registry.endGrantAuthentication(account.address),
      "Allowed end authentication process"
    ).to.be.revertedWith(
      /Contract is no longer pending or has already been approved by registry/
    );
  });

  it("does not allow start twice", async () => {
    const account = accounts[0];

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.startGrantAuthentication(account.address);

    await expect(
      registry.startGrantAuthentication(account.address),
      "Start of authentication process allowed twice"
    ).to.be.revertedWith(/Contract is already allowed in registry, or pending/);
  });

  it("does not allow end without start", async () => {
    const registry = await loadFixture(deployWyvernRegistryFixture);

    await expect(
      registry.endGrantAuthentication(accounts[1].address),
      "End of authentication process allowed without start"
    ).to.be.revertedWith(
      /Contract is no longer pending or has already been approved by registry/
    );
  });

  it("allows end after time has passed", async () => {
    const account = accounts[0];

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.startGrantAuthentication(account.address);

    await time.increase(86400 * 7 * 3);
    await registry.endGrantAuthentication(account.address);

    let result = await registry.contracts(account.address);

    expect(result, "Auth was not granted").to.be.true;
    await registry.revokeAuthentication(account.address);

    result = await registry.contracts(account.address);
    expect(result, "Auth was not revoked").to.be.false;
  });

  it("allows proxy registration for another user", async () => {
    const account = accounts[1];

    const registry = await loadFixture(deployWyvernRegistryFixture);
    await registry.registerProxyFor(account.address);
    let proxy = await registry.proxies(account.address);

    expect(proxy.length).to.be.greaterThan(0);
  });

  it("does not allow proxy registration for another user if a proxy already exists", async () => {
    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.registerProxyFor(accounts[1].address);

    await expect(
      registry.registerProxyFor(accounts[1].address),
      "Should not have succeeded"
    ).to.be.revertedWith(/User already has a proxy/);
  });

  it("does not allow proxy transfer from another account", async () => {
    const account = accounts[2];

    const registry = await loadFixture(deployWyvernRegistryFixture);
    const proxy = await registry.proxies(account.address);

    await expect(
      registry.transferAccessTo(proxy, account.address),
      "Should not have succeeded"
    ).to.be.revertedWith(/Proxy transfer can only be called by the proxy/);
  });

  it("allows proxy revocation", async () => {
    const account = accounts[1];

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.connect(account).registerProxy();

    const proxy = await registry.proxies(account.address);

    const AuthenticatedProxyArtifact = await artifacts.readArtifact(
      "AuthenticatedProxy"
    );

    const contract_at = await ethers.getContractAt(
      AuthenticatedProxyArtifact.abi,
      proxy
    );
    const contract = new ethers.Contract(
      proxy,
      AuthenticatedProxyArtifact.abi,
      accounts[0]
    );
    const user = await contract_at.user();

    expect(user).to.equal(account.address);

    await contract.connect(account).setRevoke(true);

    expect(await contract.revoked(), "Should be revoked").to.be.true;
    expect(
      await contract.connect(account).setRevoke(false),
      "Should be unrevoked"
    ).to.be.ok;
  });

  it("does not allow revoke from another account", async () => {
    const account = accounts[3];

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.connect(account).registerProxy();

    const proxy = await registry.proxies(account.address);

    const AuthenticatedProxyArtifact = await artifacts.readArtifact(
      "AuthenticatedProxy"
    );

    const contract = new ethers.Contract(proxy, AuthenticatedProxyArtifact.abi);

    await expect(
      contract.connect(accounts[1]).setRevoke(true),
      "Revocation was allowed from another account"
    ).to.be.revertedWith(/Authenticated proxy can only be revoked by its user/);
  });

  it("should not allow proxy reinitialization", async () => {
    const account = accounts[1];

    const registry = await loadFixture(deployWyvernRegistryFixture);

    await registry.connect(account).registerProxy();

    const proxy = await registry.proxies(account.address);

    const AuthenticatedProxyArtifact = await artifacts.readArtifact(
      "AuthenticatedProxy"
    );

    const contract = new ethers.Contract(proxy, AuthenticatedProxyArtifact.abi);

    await expect(
      contract.connect(account).initialize(registry.target, registry.target),
      "Should not have succeeded"
    ).to.be.revertedWith(/Authenticated proxy already initialized/);
  });

  it("allows delegateproxy owner change, but only from owner", async () => {
    const account = accounts[1];

    const [registry, testProxy] = await Promise.all([
      loadFixture(deployWyvernRegistryFixture),
      loadFixture(deployTestAuthenticatedProxyFixture),
    ]);

    await registry.connect(account).registerProxy();

    const proxy = await registry.proxies(account.address);

    const AuthenticatedProxyArtifact = await artifacts.readArtifact(
      "AuthenticatedProxy"
    );
    const TestAuthenticatedProxyArtifact = await artifacts.readArtifact(
      "TestAuthenticatedProxy"
    );

    const contract_at = await ethers.getContractAt(
      AuthenticatedProxyArtifact.abi,
      proxy,
      accounts[0]
    );

    let user = await contract_at.user();

    expect(user).to.equal(account.address);

    const iface = new ethers.Interface(TestAuthenticatedProxyArtifact.abi);

    const call = iface.encodeFunctionData("setUser", [accounts[4].address]);

    await expect(
      contract_at.connect(accounts[4]).proxyAssert(testProxy.target, 1, call),
      "Should not have succeeded"
    ).to.be.revertedWith(
      /Authenticated proxy can only be called by its user, or by a contract authorized by the registry as long as the user has not revoked access/
    );

    await contract_at.connect(account).proxyAssert(testProxy.target, 1, call);

    user = await contract_at.user();

    expect(user, "User was not changed").to.equal(accounts[4].address);
  });
});
