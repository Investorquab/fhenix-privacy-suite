import { HardhatUserConfig, subtask } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "cofhe-hardhat-plugin";
import "./tasks/deploy-auction";
import "./tasks/deploy-voting";
import "./tasks/deploy-token";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: { solcVersion: string }, _hre: any, runSuper: any) => {
  if (args.solcVersion === "0.8.25") {
    const p = path.join(process.env.HOME ?? "/root", ".cache/hardhat-nodejs/compilers-v2/linux-amd64", "solc-linux-amd64-v0.8.25+commit.b61c2a91");
    if (fs.existsSync(p)) return { compilerPath: p, isSolcJs: false, version: "0.8.25", longVersion: "0.8.25+commit.b61c2a91" };
  }
  return runSuper();
});

const config: HardhatUserConfig = {
  solidity: { version: "0.8.25", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  networks: {
    hardhat: {},
    "arb-sepolia": {
      url: process.env.ARB_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 421614,
    },
  },
  typechain: { outDir: "typechain-types", target: "ethers-v6" },
};
export default config;
