import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { cofhejs, Encryptable, FheTypes } from "cofhejs/node";

task("deploy-token", "Deploy and demo ConfidentialToken")
  .setAction(async (_, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    console.log("\n🔧 Deploying CoFHE mocks...");
    await hre.run("task:cofhe-mocks:deploy");
    console.log("  ✅ Mocks ready\n");

    const [owner, alice, bob, carol] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ConfidentialToken");
    const token = await Factory.connect(owner).deploy("PrivToken", "PRIV", 18);
    await token.waitForDeployment();
    console.log("📦 Deployed at:", await token.getAddress());

    async function enc(signer: any, amount: bigint) {
      await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(signer));
      const [e] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(amount)] as const));
      return e;
    }

    async function showBal(label: string, signer: any, address: string) {
      await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(signer));
      const handle = await token.balanceOf(address);
      const result = await cofhejs.unseal(handle, FheTypes.Uint32);
      // result is already resolved
      console.log(`  ${label}: ${result.data} PRIV`);
    }

    console.log("\n🪙 Minting...");
    await (await token.connect(owner).mint(alice.address, await enc(owner, 1000n))).wait();
    await (await token.connect(owner).mint(bob.address, await enc(owner, 500n))).wait();
    console.log("\n📊 After mint:"); await showBal("Alice", alice, alice.address); await showBal("Bob  ", bob, bob.address);

    console.log("\n💸 Alice transfers 300 to Carol...");
    await (await token.connect(alice).transfer(carol.address, await enc(alice, 300n))).wait();
    console.log("\n📊 After transfer:"); await showBal("Alice", alice, alice.address); await showBal("Carol", carol, carol.address);

    console.log("\n🔒 Bob tries to send 9999 (has 500) — sends 0, no revert...");
    await (await token.connect(bob).transfer(carol.address, await enc(bob, 9999n))).wait();
    console.log("\n📊 After failed attempt:"); await showBal("Bob  ", bob, bob.address); await showBal("Carol", carol, carol.address);

    console.log("\n✍️  Alice approves Bob 200, Bob transferFrom 150 to Carol...");
    await (await token.connect(alice).approve(bob.address, await enc(alice, 200n))).wait();
    await (await token.connect(bob).transferFrom(alice.address, carol.address, await enc(bob, 150n))).wait();

    console.log("\n📊 Final balances:");
    await showBal("Alice", alice, alice.address);
    await showBal("Bob  ", bob, bob.address);
    await showBal("Carol", carol, carol.address);

    console.log("\n🔥 Carol burns 50...");
    await (await token.connect(carol).burn(await enc(carol, 50n))).wait();
    await showBal("Carol after burn", carol, carol.address);
    console.log("\n✅ All balances encrypted on-chain the entire time.\n");
  });
