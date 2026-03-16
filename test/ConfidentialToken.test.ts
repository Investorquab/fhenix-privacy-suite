import { expect } from "chai";
import hre from "hardhat";
import { cofhejs, Encryptable, FheTypes } from "cofhejs/node";

describe("ConfidentialToken", function () {
  async function deploy() {
    const [owner, alice, bob, carol] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("ConfidentialToken");
    const token = await Factory.connect(owner).deploy("PrivToken", "PRIV", 18);
    await token.waitForDeployment();
    return { token, owner, alice, bob, carol };
  }

  async function encryptAmt(signer: any, amount: bigint) {
    await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(signer));
    const [enc] = await hre.cofhe.expectResultSuccess(
      cofhejs.encrypt([Encryptable.uint32(amount)] as const)
    );
    return enc;
  }

  async function expectBalance(token: any, address: string, expected: bigint) {
    const handle = await token.balanceOf(address);
    await hre.cofhe.mocks.expectPlaintext(handle, expected);
  }

  async function expectAllowance(token: any, owner: string, spender: string, expected: bigint) {
    const handle = await token.allowance(owner, spender);
    await hre.cofhe.mocks.expectPlaintext(handle, expected);
  }

  it("deploys with correct metadata", async function () {
    const { token } = await deploy();
    expect(await token.name()).to.equal("PrivToken");
    expect(await token.symbol()).to.equal("PRIV");
    expect(await token.decimals()).to.equal(18);
  });

  it("owner can mint encrypted tokens", async function () {
    const { token, owner, alice } = await deploy();
    await token.connect(owner).mint(alice.address, await encryptAmt(owner, 1000n));
    await expectBalance(token, alice.address, 1000n);
  });

  it("only owner can mint", async function () {
    const { token, alice } = await deploy();
    await expect(token.connect(alice).mint(alice.address, await encryptAmt(alice, 100n)))
      .to.be.revertedWithCustomError(token, "OnlyOwner");
  });

  it("minting to multiple addresses works independently", async function () {
    const { token, owner, alice, bob } = await deploy();
    await token.connect(owner).mint(alice.address, await encryptAmt(owner, 500n));
    await token.connect(owner).mint(bob.address, await encryptAmt(owner, 300n));
    await expectBalance(token, alice.address, 500n);
    await expectBalance(token, bob.address, 300n);
  });

  it("transfer moves encrypted balance between accounts", async function () {
    const { token, owner, alice, bob } = await deploy();
    await token.connect(owner).mint(alice.address, await encryptAmt(owner, 1000n));
    await token.connect(alice).transfer(bob.address, await encryptAmt(alice, 400n));
    await expectBalance(token, alice.address, 600n);
    await expectBalance(token, bob.address, 400n);
  });

  it("transfer with insufficient balance sends zero (no revert)", async function () {
    const { token, owner, alice, bob } = await deploy();
    await token.connect(owner).mint(alice.address, await encryptAmt(owner, 100n));
    await token.connect(alice).transfer(bob.address, await encryptAmt(alice, 500n));
    await expectBalance(token, alice.address, 100n);
    await expectBalance(token, bob.address, 0n);
  });

  it("multiple sequential transfers work correctly", async function () {
    const { token, owner, alice, bob, carol } = await deploy();
    await token.connect(owner).mint(alice.address, await encryptAmt(owner, 1000n));
    await token.connect(alice).transfer(bob.address, await encryptAmt(alice, 300n));
    await token.connect(alice).transfer(carol.address, await encryptAmt(alice, 200n));
    await token.connect(bob).transfer(carol.address, await encryptAmt(bob, 100n));
    await expectBalance(token, alice.address, 500n);
    await expectBalance(token, bob.address, 200n);
    await expectBalance(token, carol.address, 300n);
  });

  it("approve sets encrypted allowance", async function () {
    const { token, owner, alice, bob } = await deploy();
    await token.connect(owner).mint(alice.address, await encryptAmt(owner, 1000n));
    await token.connect(alice).approve(bob.address, await encryptAmt(alice, 500n));
    await expectAllowance(token, alice.address, bob.address, 500n);
  });

  it("transferFrom spends allowance correctly", async function () {
    const { token, owner, alice, bob, carol } = await deploy();
    await token.connect(owner).mint(alice.address, await encryptAmt(owner, 1000n));
    await token.connect(alice).approve(bob.address, await encryptAmt(alice, 400n));
    await token.connect(bob).transferFrom(alice.address, carol.address, await encryptAmt(bob, 250n));
    await expectBalance(token, alice.address, 750n);
    await expectBalance(token, carol.address, 250n);
    await expectAllowance(token, alice.address, bob.address, 150n);
  });

  it("transferFrom with insufficient allowance sends zero", async function () {
    const { token, owner, alice, bob, carol } = await deploy();
    await token.connect(owner).mint(alice.address, await encryptAmt(owner, 1000n));
    await token.connect(alice).approve(bob.address, await encryptAmt(alice, 50n));
    await token.connect(bob).transferFrom(alice.address, carol.address, await encryptAmt(bob, 500n));
    await expectBalance(token, alice.address, 1000n);
    await expectBalance(token, carol.address, 0n);
  });

  it("burn reduces caller balance", async function () {
    const { token, owner, alice } = await deploy();
    await token.connect(owner).mint(alice.address, await encryptAmt(owner, 1000n));
    await token.connect(alice).burn(await encryptAmt(alice, 400n));
    await expectBalance(token, alice.address, 600n);
  });

  it("burn with insufficient balance burns zero", async function () {
    const { token, owner, alice } = await deploy();
    await token.connect(owner).mint(alice.address, await encryptAmt(owner, 100n));
    await token.connect(alice).burn(await encryptAmt(alice, 9999n));
    await expectBalance(token, alice.address, 100n);
  });
});
