import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { cofhejs, Encryptable } from "cofhejs/node";

task("deploy-auction", "Deploy and demo SealedBidAuction")
  .addOptionalParam("duration", "Auction duration in seconds", "300")
  .setAction(async ({ duration }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;

    // Deploy CoFHE mock infrastructure (normally done by the test runner)
    console.log("\n🔧 Deploying CoFHE mocks...");
    await hre.run("task:cofhe-mocks:deploy");
    console.log("  ✅ Mocks ready");

    const [owner, alice, bob, carol] = await ethers.getSigners();
    console.log("\n📦 Deploying SealedBidAuction...");
    const Factory = await ethers.getContractFactory("SealedBidAuction");
    const auction = await Factory.connect(owner).deploy(parseInt(duration), "Fhenix Genesis NFT #001");
    await auction.waitForDeployment();
    console.log("  Deployed at:", await auction.getAddress());

    async function encryptBid(signer: any, amount: bigint) {
      await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(signer));
      const [enc] = await hre.cofhe.expectResultSuccess(
        cofhejs.encrypt([Encryptable.uint32(amount)] as const)
      );
      return enc;
    }

    console.log("\n🔐 Alice bids 150 (encrypted)");
    await (await auction.connect(alice).placeBid(await encryptBid(alice, 150n))).wait();
    console.log("  ✅ placed");

    console.log("🔐 Bob bids 275 (encrypted)");
    await (await auction.connect(bob).placeBid(await encryptBid(bob, 275n))).wait();
    console.log("  ✅ placed");

    console.log("🔐 Carol bids 199 (encrypted)");
    await (await auction.connect(carol).placeBid(await encryptBid(carol, 199n))).wait();
    console.log("  ✅ placed");

    console.log("\n⏩ Fast-forwarding past deadline...");
    await hre.network.provider.send("evm_increaseTime", [parseInt(duration) + 1]);
    await hre.network.provider.send("evm_mine");

    console.log("🏁 Finalizing (FHE.gt comparisons via CoFHE)...");
    await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner));
    await (await auction.connect(owner).finalize()).wait();

    const [desc, , isFinalized, auctionWinner, totalBidders] = await auction.getAuctionInfo();
    console.log("\n🎉 Results:");
    console.log("  Item      :", desc);
    console.log("  Bidders   :", totalBidders.toString());
    console.log("  Winner    :", auctionWinner);
    console.log("  Finalized :", isFinalized);
    console.log("\n✅ All bids stayed encrypted on-chain the entire time.\n");
  });
