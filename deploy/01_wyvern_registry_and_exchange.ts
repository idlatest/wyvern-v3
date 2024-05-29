import { DeployFunction } from "hardhat-deploy/dist/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const personalSignPrefixes = {
  default: "\x19Ethereum Signed Message:\n",
  klaytn: "\x19Klaytn Signed Message:\n",
  baobab: "\x19Klaytn Signed Message:\n",
};

const func: DeployFunction = async function ({
  deployments,
  getUnnamedAccounts,
  network,
  getChainId,
}: HardhatRuntimeEnvironment) {
  const { deploy, execute } = deployments;
  const [deployer] = await getUnnamedAccounts();
  const chainId = await getChainId();

  const personalSignPrefix =
    personalSignPrefixes[network.name as keyof typeof personalSignPrefixes] ||
    personalSignPrefixes["default"];

  const wyvernRegistryResult = await deploy("WyvernRegistry", {
    from: deployer,
    log: true,
  });
  const wyvernExchangeResult = await deploy("WyvernExchange", {
    from: deployer,
    args: [
      chainId,
      [
        wyvernRegistryResult.address,
        "0xa5409ec958C83C3f309868babACA7c86DCB077c1",
      ],
      Buffer.from(personalSignPrefix, "binary"),
    ],
    log: true,
  });

  await execute(
    "WyvernRegistry",
    { from: deployer, log: true },
    "grantInitialAuthentication",
    wyvernExchangeResult.address
  );
};

export default func;
func.tags = ["WyvernRegistry", "WyvernExchange"];
