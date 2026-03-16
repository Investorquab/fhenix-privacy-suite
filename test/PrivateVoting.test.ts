import { expect } from "chai";
import hre from "hardhat";
import { cofhejs, Encryptable, FheTypes } from "cofhejs/node";

describe("PrivateVoting", function () {
  const DURATION = 300;

  async function deploy() {
    const [owner, alice, bob, carol, dave] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("PrivateVoting");
    const voting = await Factory.connect(owner).deploy();
    await voting.waitForDeployment();
    return { voting, owner, alice, bob, carol, dave };
  }

  async function encryptVote(signer: any, value: 0n | 1n) {
    await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(signer));
    const [enc] = await hre.cofhe.expectResultSuccess(
      cofhejs.encrypt([Encryptable.uint32(value)] as const)
    );
    return enc;
  }

  async function fastForward() {
    await hre.network.provider.send("evm_increaseTime", [DURATION + 1]);
    await hre.network.provider.send("evm_mine");
  }

  it("creates a proposal with correct metadata", async function () {
    const { voting, owner } = await deploy();
    await (await voting.connect(owner).createProposal("Dev grants?", DURATION)).wait();
    const [desc, , totalVotes, finalized] = await voting.getProposal(0);
    expect(desc).to.equal("Dev grants?");
    expect(totalVotes).to.equal(0n);
    expect(finalized).to.be.false;
  });

  it("tracks isActive correctly", async function () {
    const { voting, owner } = await deploy();
    await (await voting.connect(owner).createProposal("Test", DURATION)).wait();
    expect(await voting.isActive(0)).to.be.true;
    await fastForward();
    expect(await voting.isActive(0)).to.be.false;
  });

  it("only owner can create proposals", async function () {
    const { voting, alice } = await deploy();
    await expect(voting.connect(alice).createProposal("Rogue", DURATION))
      .to.be.revertedWithCustomError(voting, "OnlyOwner");
  });

  it("accepts encrypted FOR votes", async function () {
    const { voting, owner, alice } = await deploy();
    await (await voting.connect(owner).createProposal("Test", DURATION)).wait();
    await voting.connect(alice).castVote(0, await encryptVote(alice, 1n));
    expect(await voting.hasVoted(0, alice.address)).to.be.true;
    const [, , totalVotes] = await voting.getProposal(0);
    expect(totalVotes).to.equal(1n);
  });

  it("accepts encrypted AGAINST votes", async function () {
    const { voting, owner, bob } = await deploy();
    await (await voting.connect(owner).createProposal("Test", DURATION)).wait();
    await voting.connect(bob).castVote(0, await encryptVote(bob, 0n));
    expect(await voting.hasVoted(0, bob.address)).to.be.true;
  });

  it("rejects duplicate votes", async function () {
    const { voting, owner, alice } = await deploy();
    await (await voting.connect(owner).createProposal("Test", DURATION)).wait();
    await voting.connect(alice).castVote(0, await encryptVote(alice, 1n));
    await expect(voting.connect(alice).castVote(0, await encryptVote(alice, 1n)))
      .to.be.revertedWithCustomError(voting, "AlreadyVoted");
  });

  it("rejects votes after deadline", async function () {
    const { voting, owner, alice } = await deploy();
    await (await voting.connect(owner).createProposal("Test", DURATION)).wait();
    await fastForward();
    await expect(voting.connect(alice).castVote(0, await encryptVote(alice, 1n)))
      .to.be.revertedWithCustomError(voting, "ProposalEnded");
  });

  it("counts votes from multiple voters", async function () {
    const { voting, owner, alice, bob, carol } = await deploy();
    await (await voting.connect(owner).createProposal("Test", DURATION)).wait();
    await voting.connect(alice).castVote(0, await encryptVote(alice, 1n));
    await voting.connect(bob).castVote(0, await encryptVote(bob, 1n));
    await voting.connect(carol).castVote(0, await encryptVote(carol, 0n));
    const [, , totalVotes] = await voting.getProposal(0);
    expect(totalVotes).to.equal(3n);
  });

  it("rejects finalize before deadline", async function () {
    const { voting, owner } = await deploy();
    await (await voting.connect(owner).createProposal("Test", DURATION)).wait();
    await expect(voting.connect(owner).finalizeProposal(0))
      .to.be.revertedWithCustomError(voting, "ProposalActive");
  });

  it("passes when FOR > AGAINST", async function () {
    const { voting, owner, alice, bob, carol } = await deploy();
    await (await voting.connect(owner).createProposal("Test", DURATION)).wait();
    await voting.connect(alice).castVote(0, await encryptVote(alice, 1n));
    await voting.connect(bob).castVote(0, await encryptVote(bob, 1n));
    await voting.connect(carol).castVote(0, await encryptVote(carol, 1n));
    await fastForward();
    await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner));
    await voting.connect(owner).finalizeProposal(0);
    const [, , , finalized, passed] = await voting.getProposal(0);
    expect(finalized).to.be.true;
    expect(passed).to.be.true;
  });

  it("fails when AGAINST >= FOR — tallies confirm via unseal", async function () {
    const { voting, owner, alice, bob, carol, dave } = await deploy();
    await (await voting.connect(owner).createProposal("Test", DURATION)).wait();
    await voting.connect(alice).castVote(0, await encryptVote(alice, 1n));
    await voting.connect(bob).castVote(0, await encryptVote(bob, 0n));
    await voting.connect(carol).castVote(0, await encryptVote(carol, 0n));
    await voting.connect(dave).castVote(0, await encryptVote(dave, 0n));
    await fastForward();
    await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner));
    await voting.connect(owner).finalizeProposal(0);
    const [, , , finalized, , forTally, againstTally] = await voting.getProposal(0);
    expect(finalized).to.be.true;
    // Validate via mock plaintext: AGAINST (3) > FOR (1)
    await hre.cofhe.mocks.expectPlaintext(forTally, 1n);
    await hre.cofhe.mocks.expectPlaintext(againstTally, 3n);
  });

  it("rejects double finalize", async function () {
    const { voting, owner, alice } = await deploy();
    await (await voting.connect(owner).createProposal("Test", DURATION)).wait();
    await voting.connect(alice).castVote(0, await encryptVote(alice, 1n));
    await fastForward();
    await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner));
    await voting.connect(owner).finalizeProposal(0);
    await expect(voting.connect(owner).finalizeProposal(0))
      .to.be.revertedWithCustomError(voting, "AlreadyFinalized");
  });
});
