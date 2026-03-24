require("@nomicfoundation/hardhat-toolbox");
try {
  require("dotenv").config();
} catch (error) {
  // Allow Hardhat to run before dotenv is installed; env vars still work if set externally.
}

const solc = require("solc");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion !== "0.8.26") {
    return runSuper(args);
  }

  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: "0.8.26",
    longVersion: solc.version(),
  };
});

const {
  SEPOLIA_URL,
  SEPOLIA_RPC_URL,
  ALCHEMY_API_KEY,
  INFURA_API_KEY,
  PRIVATE_KEY,
  ETHERSCAN_API_KEY,
} = process.env;

function getAccounts() {
  if (!PRIVATE_KEY) {
    return [];
  }

  const normalized = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY.slice(2) : PRIVATE_KEY;
  return normalized.length === 64 ? [PRIVATE_KEY] : [];
}

function getSepoliaRpcUrl() {
  if (SEPOLIA_URL) {
    return SEPOLIA_URL;
  }

  if (SEPOLIA_RPC_URL) {
    return SEPOLIA_RPC_URL;
  }

  if (ALCHEMY_API_KEY) {
    return `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  }

  if (INFURA_API_KEY) {
    return `https://sepolia.infura.io/v3/${INFURA_API_KEY}`;
  }

  return "https://rpc.sepolia.org";
}

const sepoliaRpcUrl = getSepoliaRpcUrl();
const accounts = getAccounts();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
      viaIR: true,
    },
  },
  networks: {
    sepolia: {
      url: sepoliaRpcUrl,
      chainId: 11155111,
      accounts,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || "",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
