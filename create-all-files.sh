#!/bin/bash
set -e

echo "Writing SealedBidAuction.sol..."
mkdir -p contracts
cat > contracts/SealedBidAuction.sol << 'SOLIDITY'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FHE, euint32, inEuint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract SealedBidAuction {
    address public immutable owner;
    uint256 public immutable deadline;
    string  public itemDescription;
    bool    public finalized;
    address public winner;

    mapping(address => euint32) private encryptedBids;
    mapping(address => bool)    public  hasBid;
    address[]                   private bidders;
    euint32 private encryptedHighestBid;

    event BidPlaced(address indexed bidder);
    event AuctionFinalized(address indexed winner);

    error AuctionEnded();
    error AuctionNotEnded();
    error AlreadyFinalized();
    error AlreadyBid();

    constructor(uint256 durationSeconds, string memory _itemDescription) {
        owner           = msg.sender;
        deadline        = block.timestamp + durationSeconds;
        itemDescription = _itemDescription;
    }

    modifier onlyWhileActive() {
        if (block.timestamp >= deadline) revert AuctionEnded();
        _;
    }
    modifier onlyAfterDeadline() {
        if (block.timestamp < deadline) revert AuctionNotEnded();
        _;
    }

    function placeBid(inEuint32 calldata _encryptedBid) external onlyWhileActive {
        if (hasBid[msg.sender]) revert AlreadyBid();
        euint32 bid = FHE.asEuint32(_encryptedBid);
        FHE.allowThis(bid);
        FHE.allowSender(bid);
        encryptedBids[msg.sender] = bid;
        hasBid[msg.sender]        = true;
        bidders.push(msg.sender);
        emit BidPlaced(msg.sender);
    }

    function finalize() external onlyAfterDeadline {
        if (finalized) revert AlreadyFinalized();
        require(bidders.length > 0, "No bids");

        euint32 highestBid = encryptedBids[bidders[0]];
        address leader     = bidders[0];

        for (uint256 i = 1; i < bidders.length; i++) {
            euint32 challenger = encryptedBids[bidders[i]];
            euint32 newMax = FHE.select(FHE.gt(challenger, highestBid), challenger, highestBid);
            FHE.allowThis(newMax);
            highestBid = newMax;
            leader = bidders[i];
        }

        winner    = leader;
        finalized = true;
        FHE.allow(highestBid, winner);
        FHE.allowThis(highestBid);
        encryptedHighestBid = highestBid;
        emit AuctionFinalized(winner);
    }

    function getEncryptedWinningBid() external view returns (euint32) {
        require(finalized, "Not finalized");
        return encryptedHighestBid;
    }

    function getAuctionInfo() external view returns (
        string memory, uint256, bool, address, uint256
    ) {
        return (itemDescription, deadline, finalized, winner, bidders.length);
    }

    function timeRemaining() external view returns (uint256) {
        if (block.timestamp >= deadline) return 0;
        return deadline - block.timestamp;
    }
}
SOLIDITY
echo "  done: contracts/SealedBidAuction.sol"

echo "Writing tasks/deploy-auction.ts..."
mkdir -p tasks
cat > tasks/deploy-auction.ts << 'TASK'
import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { cofhejs_initializeWithHardhatSigner, cofhejs, Encryptable } from "cofhejs/node";

task("deploy-auction", "Deploy and demo SealedBidAuction")
  .addOptionalParam("duration", "Auction duration in seconds", "300")
  .setAction(async ({ duration }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const [owner, alice, bob, carol] = await ethers.getSigners();
    console.log("\n Deploying SealedBidAuction...");
    const Factory = await ethers.getContractFactory("SealedBidAuction");
    const auction = await Factory.connect(owner).deploy(parseInt(duration), "Fhenix Genesis NFT #001");
    await auction.waitForDeployment();
    console.log("  Deployed at:", await auction.getAddress());

    console.log("\n Alice bids 150 (encrypted)");
    await cofhejs_initializeWithHardhatSigner(alice);
    const [aliceBid] = await cofhejs.encrypt(() => {}, [Encryptable.uint32(150n)]);
    await (await auction.connect(alice).placeBid(aliceBid)).wait();

    console.log(" Bob bids 275 (encrypted)");
    await cofhejs_initializeWithHardhatSigner(bob);
    const [bobBid] = await cofhejs.encrypt(() => {}, [Encryptable.uint32(275n)]);
    await (await auction.connect(bob).placeBid(bobBid)).wait();

    console.log(" Carol bids 199 (encrypted)");
    await cofhejs_initializeWithHardhatSigner(carol);
    const [carolBid] = await cofhejs.encrypt(() => {}, [Encryptable.uint32(199n)]);
    await (await auction.connect(carol).placeBid(carolBid)).wait();

    console.log("\n Fast-forwarding past deadline...");
    await hre.network.provider.send("evm_increaseTime", [parseInt(duration) + 1]);
    await hre.network.provider.send("evm_mine");

    console.log(" Finalizing (FHE.gt comparisons via CoFHE)...");
    await cofhejs_initializeWithHardhatSigner(owner);
    await (await auction.connect(owner).finalize()).wait();

    const [desc, , isFinalized, auctionWinner, totalBidders] = await auction.getAuctionInfo();
    console.log("\n Results:");
    console.log("  Item      :", desc);
    console.log("  Bidders   :", totalBidders.toString());
    console.log("  Winner    :", auctionWinner);
    console.log("  Finalized :", isFinalized);
    console.log("\n Bids were encrypted on-chain the entire time.\n");
  });
TASK
echo "  done: tasks/deploy-auction.ts"

echo "Writing test/SealedBidAuction.test.ts..."
mkdir -p test
cat > test/SealedBidAuction.test.ts << 'TESTFILE'
import { expect } from "chai";
import hre from "hardhat";
import { cofhejs_initializeWithHardhatSigner, cofhejs, Encryptable } from "cofhejs/node";

describe("SealedBidAuction", function () {
  const DURATION = 300;

  async function deploy() {
    const [owner, alice, bob, carol] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("SealedBidAuction");
    const auction = await Factory.connect(owner).deploy(DURATION, "Test NFT");
    await auction.waitForDeployment();
    return { auction, owner, alice, bob, carol };
  }

  async function encryptBid(signer: any, amount: bigint) {
    await cofhejs_initializeWithHardhatSigner(signer);
    const [enc] = await cofhejs.encrypt(() => {}, [Encryptable.uint32(amount)]);
    return enc;
  }

  async function fastForward() {
    await hre.network.provider.send("evm_increaseTime", [DURATION + 1]);
    await hre.network.provider.send("evm_mine");
  }

  it("accepts encrypted bids", async function () {
    const { auction, alice, bob } = await deploy();
    await auction.connect(alice).placeBid(await encryptBid(alice, 100n));
    await auction.connect(bob).placeBid(await encryptBid(bob, 200n));
    expect(await auction.hasBid(alice.address)).to.be.true;
    expect(await auction.hasBid(bob.address)).to.be.true;
  });

  it("rejects duplicate bids", async function () {
    const { auction, alice } = await deploy();
    await auction.connect(alice).placeBid(await encryptBid(alice, 100n));
    await expect(auction.connect(alice).placeBid(await encryptBid(alice, 200n)))
      .to.be.revertedWithCustomError(auction, "AlreadyBid");
  });

  it("rejects bids after deadline", async function () {
    const { auction, alice } = await deploy();
    await fastForward();
    await expect(auction.connect(alice).placeBid(await encryptBid(alice, 100n)))
      .to.be.revertedWithCustomError(auction, "AuctionEnded");
  });

  it("rejects finalize before deadline", async function () {
    const { auction, owner, alice } = await deploy();
    await auction.connect(alice).placeBid(await encryptBid(alice, 100n));
    await expect(auction.connect(owner).finalize())
      .to.be.revertedWithCustomError(auction, "AuctionNotEnded");
  });

  it("finalizes with correct bidder count", async function () {
    const { auction, owner, alice, bob, carol } = await deploy();
    await auction.connect(alice).placeBid(await encryptBid(alice, 100n));
    await auction.connect(bob).placeBid(await encryptBid(bob, 275n));
    await auction.connect(carol).placeBid(await encryptBid(carol, 199n));
    await fastForward();
    await auction.connect(owner).finalize();
    const [, , isFinalized, , totalBidders] = await auction.getAuctionInfo();
    expect(isFinalized).to.be.true;
    expect(totalBidders).to.equal(3n);
  });

  it("rejects double finalize", async function () {
    const { auction, owner, alice } = await deploy();
    await auction.connect(alice).placeBid(await encryptBid(alice, 100n));
    await fastForward();
    await auction.connect(owner).finalize();
    await expect(auction.connect(owner).finalize())
      .to.be.revertedWithCustomError(auction, "AlreadyFinalized");
  });
});
TESTFILE
echo "  done: test/SealedBidAuction.test.ts"

echo "Patching hardhat.config.ts..."
cp hardhat.config.ts hardhat.config.ts.bak
cat > hardhat.config.ts << 'HARDHATCONFIG'
import { HardhatUserConfig, subtask } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "cofhe-hardhat-plugin";
import "./tasks/deploy-auction";
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
  solidity: { version: "0.8.25", settings: { optimizer: { enabled: true, runs: 200 } } },
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
HARDHATCONFIG
echo "  done: hardhat.config.ts"

echo ""
echo "All done! Now run:"
echo "  pnpm test"
echo "  pnpm hardhat deploy-auction --network hardhat"
