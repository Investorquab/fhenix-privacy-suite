import { expect } from "chai";
import hre from "hardhat";
import { cofhejs, Encryptable, FheTypes } from "cofhejs/node";

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
    await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(signer));
    const [enc] = await hre.cofhe.expectResultSuccess(
      cofhejs.encrypt([Encryptable.uint32(amount)] as const)
    );
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
