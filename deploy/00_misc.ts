import { DeployFunction } from "hardhat-deploy/dist/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function ({
  deployments,
  getUnnamedAccounts,
  network,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const [deployer] = await getUnnamedAccounts();

  const wyvernAtomicizerResult = await deploy("WyvernAtomicizer", {
    from: deployer,
    log: true,
  });
  await deploy("WyvernStatic", {
    args: [wyvernAtomicizerResult.address],
    from: deployer,
    log: true,
  });
  await deploy("StaticMarket", { from: deployer, log: true });

  if (network.name !== "coverage" && network.name !== "development") return;

  await deploy("TestERC20", { from: deployer, log: true });
  await deploy("TestERC721", { from: deployer, log: true });
  await deploy("TestAuthenticatedProxy", { from: deployer, log: true });
  await deploy("TestERC1271", { from: deployer, log: true });
  await deploy("TestSmartContractWallet", { from: deployer, log: true });
};

export default func;
func.tags = ["WyvernAtomicizer", "WyvernStatic", "StaticMarket"];
