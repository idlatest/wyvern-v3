const { CHAIN_ID } = require("./util");
const WyvernAtomicizer = artifacts.require("WyvernAtomicizer");
const WyvernStatic = artifacts.require("WyvernStatic");
const WyvernRegistry = artifacts.require("WyvernRegistry");
const WyvernExchange = artifacts.require("WyvernExchange");
const AuthenticatedProxy = artifacts.require("AuthenticatedProxy");
const OwnableDelegateProxy = artifacts.require("OwnableDelegateProxy");
const TestAuthenticatedProxy = artifacts.require("TestAuthenticatedProxy");
const TestERC20 = artifacts.require("TestERC20");
const StaticMarket = artifacts.require("StaticMarket");
const TestERC721 = artifacts.require("TestERC721");
const TestERC1155 = artifacts.require("TestERC1155");
const TestERC1271 = artifacts.require("TestERC1271");
const TestSmartContractWallet = artifacts.require("TestSmartContractWallet");

module.exports = async () => {
  const wyvernAtomicizer = await WyvernAtomicizer.new();
  WyvernAtomicizer.setAsDeployed(wyvernAtomicizer);

  const wyvernStatic = await WyvernStatic.new(wyvernAtomicizer.address);
  WyvernStatic.setAsDeployed(wyvernStatic);

  const wyvernRegistry = await WyvernRegistry.new();
  WyvernRegistry.setAsDeployed(wyvernRegistry);

  const wyvernExchange = await WyvernExchange.new(
    CHAIN_ID,
    [wyvernRegistry.address],
    "0x",
  );
  WyvernExchange.setAsDeployed(wyvernExchange);

  await wyvernRegistry.grantInitialAuthentication(wyvernExchange.address);

  // const authenticatedProxy = await AuthenticatedProxy.new();
  // AuthenticatedProxy.setAsDeployed(authenticatedProxy);
  //
  // const ownableDelegateProxy = await OwnableDelegateProxy.new();
  // OwnableDelegateProxy.setAsDeployed(ownableDelegateProxy);

  const testAuthenticatedProxy = await TestAuthenticatedProxy.new();
  TestAuthenticatedProxy.setAsDeployed(testAuthenticatedProxy);

  const testERC20 = await TestERC20.new();
  TestERC20.setAsDeployed(testERC20);

  const staticMarket = await StaticMarket.new();
  StaticMarket.setAsDeployed(staticMarket);

  const testERC721 = await TestERC721.new();
  TestERC721.setAsDeployed(testERC721);

  const testERC1155 = await TestERC1155.new();
  TestERC1155.setAsDeployed(testERC1155);

  const testERC1271 = await TestERC1271.new();
  TestERC1271.setAsDeployed(testERC1271);

  const testSmartContractWallet = await TestSmartContractWallet.new();
  TestSmartContractWallet.setAsDeployed(testSmartContractWallet);
};
