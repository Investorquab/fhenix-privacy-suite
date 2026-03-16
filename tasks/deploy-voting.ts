import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { cofhejs, Encryptable, FheTypes } from "cofhejs/node";

task("deploy-voting", "Deploy and demo PrivateVoting DAO")
  .addOptionalParam("duration", "Voting duration in seconds", "300")
  .setAction(async ({ duration }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    console.log("\n🔧 Deploying CoFHE mocks...");
    await hre.run("task:cofhe-mocks:deploy");
    console.log("  ✅ Mocks ready\n");

    const [owner, alice, bob, carol, dave] = await ethers.getSigners();
    console.log("📦 Deploying PrivateVoting...");
    const Factory = await ethers.getContractFactory("PrivateVoting");
    const voting = await Factory.connect(owner).deploy();
    await voting.waitForDeployment();
    console.log("  Deployed at:", await voting.getAddress());

    async function encryptVote(signer: any, value: 0n | 1n) {
      await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(signer));
      const [enc] = await hre.cofhe.expectResultSuccess(
        cofhejs.encrypt([Encryptable.uint32(value)] as const)
      );
      return enc;
    }

    console.log('\n📋 Creating proposal: "Allocate 50k to dev grants?"');
    await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner));
    await (await voting.connect(owner).createProposal("Allocate 50k to dev grants?", parseInt(duration))).wait();

    console.log("\n🗳️  Voting (all encrypted):");
    console.log("  Alice  → FOR");
    await (await voting.connect(alice).castVote(0, await encryptVote(alice, 1n))).wait();
    console.log("  Bob    → FOR");
    await (await voting.connect(bob).castVote(0, await encryptVote(bob, 1n))).wait();
    console.log("  Carol  → FOR");
    await (await voting.connect(carol).castVote(0, await encryptVote(carol, 1n))).wait();
    console.log("  Dave   → AGAINST");
    await (await voting.connect(dave).castVote(0, await encryptVote(dave, 0n))).wait();

    const [, , totalVotes] = await voting.getProposal(0);
    console.log(`\n  Total votes: ${totalVotes} (encrypted on-chain)`);

    console.log("\n⏩ Fast-forwarding past deadline...");
    await hre.network.provider.send("evm_increaseTime", [parseInt(duration) + 1]);
    await hre.network.provider.send("evm_mine");

    console.log("🏁 Finalizing (FHE.gt on encrypted tallies)...");
    await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner));
    await (await voting.connect(owner).finalizeProposal(0)).wait();

    const [desc, , votes, finalized, passed, forTally, againstTally] = await voting.getProposal(0);
    console.log("\n🎉 Results:");
    console.log("  Proposal  :", desc);
    console.log("  Votes     :", votes.toString());
    console.log("  Passed    :", passed ? "✅ YES" : "❌ NO");

    console.log("\n🔓 Unsealing tallies (owner only)...");
    const forResult     = await cofhejs.unseal(forTally, FheTypes.Uint32);
    const againstResult = await cofhejs.unseal(againstTally, FheTypes.Uint32);
    console.log(`  FOR     : ${forResult.data}`);
    console.log(`  AGAINST : ${againstResult.data}`);
    console.log("\n✅ Votes stayed encrypted on-chain the entire time.\n");
  });
