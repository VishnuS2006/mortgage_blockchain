const fs = require("fs");
const path = require("path");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const result = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    result[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
  }

  return result;
}

function hasValue(value) {
  const normalized = String(value || "").trim();
  return Boolean(
    normalized &&
      !normalized.includes("your_api_key") &&
      !normalized.includes("your_private_key") &&
      !normalized.includes("your_sepolia_private_key") &&
      !normalized.includes("your_etherscan_api_key") &&
      !normalized.includes("0xYour") &&
      normalized !== "https://eth-sepolia.g.alchemy.com/v2/"
  );
}

function addCheck(checks, label, ok, detail) {
  checks.push({ label, ok, detail });
}

function validate() {
  const rootPath = path.resolve(__dirname, "..", ".env");
  const rootEnv = readEnvFile(rootPath);
  const checks = [];

  addCheck(checks, ".env exists", fs.existsSync(rootPath), rootPath);
  addCheck(checks, "VITE_API_URL", hasValue(rootEnv.VITE_API_URL), "Frontend API URL");
  addCheck(checks, "VITE_CHAIN_ID", String(rootEnv.VITE_CHAIN_ID || "").trim() === "11155111", "Must be 11155111 for Sepolia");
  addCheck(checks, "VITE_NETWORK_NAME", String(rootEnv.VITE_NETWORK_NAME || "").trim().toLowerCase() === "sepolia", "Must be sepolia");

  const hasSepoliaRpc =
    hasValue(rootEnv.SEPOLIA_URL) ||
    hasValue(rootEnv.SEPOLIA_RPC_URL) ||
    hasValue(rootEnv.VITE_RPC_URL) ||
    hasValue(rootEnv.ALCHEMY_API_KEY) ||
    hasValue(rootEnv.INFURA_API_KEY);

  addCheck(checks, "Sepolia RPC", hasSepoliaRpc, "SEPOLIA_URL / SEPOLIA_RPC_URL / VITE_RPC_URL / ALCHEMY_API_KEY / INFURA_API_KEY");
  addCheck(checks, "PRIVATE_KEY", hasValue(rootEnv.PRIVATE_KEY), "Deployer wallet private key for Sepolia");
  addCheck(checks, "JWT_SECRET", hasValue(rootEnv.JWT_SECRET), "Backend auth secret");

  [
    "VITE_PROPERTY_NFT_ADDRESS",
    "VITE_MORTGAGE_CORE_ADDRESS",
    "VITE_PROPERTY_ESCROW_ADDRESS",
    "VITE_LOAN_REPAYMENT_ADDRESS",
    "VITE_VERIFICATION_ADDRESS",
  ].forEach((key) => {
    addCheck(checks, key, hasValue(rootEnv[key]), "Populated after deployment");
  });

  const failed = checks.filter((entry) => !entry.ok);
  console.log("Env mode detected: sepolia only\n");

  for (const entry of checks) {
    console.log(`[${entry.ok ? "OK" : "MISSING"}] ${entry.label} -> ${entry.detail}`);
  }

  if (failed.length > 0) {
    console.log(`\nMissing ${failed.length} required or recommended env value(s).`);
    process.exitCode = 1;
    return;
  }

  console.log("\nAll checked env values look valid.");
}

validate();
