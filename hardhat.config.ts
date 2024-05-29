import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import { HardhatUserConfig } from "hardhat/config";

const sepoliaMnemonic = process.env.SEPOLIA_MNEMONIC || "";
const mumbaiMnemonic = process.env.MUMBAI_MNEMONIC || "";
const mainnetMnemonic = process.env.MAINNET_MNEMONIC || "";
const klaytnPrivateKey = process.env.KLAYTN_PRIVATE_KEY || "";
const baobabPrivateKey = process.env.BAOBAB_PRIVATE_KEY || "";
const infuraKey = process.env.INFURA_KEY || "";
//
const kasAccessKeyId = process.env.KAS_ACCESS_KEY_ID || "";
const kasSecretAccessKey = process.env.KAS_SECRET_KEY || "";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    mainnet: {
      url: "https://mainnet.infura.io",
      accounts: {
        mnemonic: mainnetMnemonic,
      },
      chainId: 1,
      gasPrice: 4310000000,
    },
    sepolia: {
      url: `https://sepolia.infura.io/v3/${infuraKey}`,
      accounts: {
        mnemonic: sepoliaMnemonic,
      },
      chainId: 11155111,
    },
    mumbai: {
      url: "https://rpc-mumbai.matic.today",
      accounts: {
        mnemonic: mumbaiMnemonic,
      },
      chainId: 80001,
    },
    baobab: {
      url: "https://node-api.klaytnapi.com/v1/klaytn",
      httpHeaders: {
        Authorization:
          "Basic " +
          Buffer.from(kasAccessKeyId + ":" + kasSecretAccessKey).toString(
            "base64"
          ),
        "x-chain-id": "1001",
      },
      accounts: [baobabPrivateKey],
      chainId: 1001,
      timeout: 10000,
      gas: 8500000,
      gasPrice: 25000000000,
    },
    klaytn: {
      url: "https://node-api.klaytnapi.com/v1/klaytn",
      httpHeaders: {
        Authorization:
          "Basic " +
          Buffer.from(kasAccessKeyId + ":" + kasSecretAccessKey).toString(
            "base64"
          ),
        "x-chain-id": "8217",
      },
      accounts: [klaytnPrivateKey],
      chainId: 8217,
      timeout: 10000,
      gas: 8500000,
      gasPrice: 25000000000,
    },
  },
  solidity: {
    version: "0.7.5",
    settings: {
      optimizer: {
        enabled: true,
        runs: 750,
      },
    },
  },
  mocha: {
    timeout: 40000,
  },
};

export default config;
