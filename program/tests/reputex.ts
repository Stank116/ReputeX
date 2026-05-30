import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import { Reputex } from "../target/types/reputex";

describe("reputex", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Reputex as Program<Reputex>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const owner = provider.wallet.publicKey;

  /** Encode a u64 as little-endian bytes for PDA seeds */
  const u64Le = (value: number) => {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    return buffer;
  };

  // ── PDAs ──────────────────────────────────────────────────────────────────
  const [protocol] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol")],
    program.programId
  );

  const marketIndex = 0;
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), u64Le(marketIndex)],
    program.programId
  );

  const [traderProfile] = PublicKey.findProgramAddressSync(
    [Buffer.from("trader"), owner.toBuffer()],
    program.programId
  );

  const [marginAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), owner.toBuffer()],
    program.programId
  );

  // ── Tests ─────────────────────────────────────────────────────────────────

  it("initializes protocol and market", async () => {
    await program.methods
      .initializeProtocol()
      .accountsStrict({
        protocol,
        authority: owner,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const INITIAL_PRICE = 10_000;
    await program.methods
      .initializeMarket(
        new anchor.BN(marketIndex),
        "SOL-PERP",
        new anchor.BN(INITIAL_PRICE)
      )
      .accountsStrict({
        protocol,
        market,
        authority: owner,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.symbol, "SOL-PERP");
    assert.equal(marketAccount.price.toNumber(), INITIAL_PRICE);

    const protocolAccount = await program.account.protocol.fetch(protocol);
    assert.equal(protocolAccount.totalMarkets.toNumber(), 1);
  });

  it("creates a trader profile and deposits mock collateral", async () => {
    await program.methods
      .createTraderProfile()
      .accountsStrict({
        protocol,
        traderProfile,
        marginAccount,
        owner,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const DEPOSIT = 1_000;
    await program.methods
      .depositCollateral(new anchor.BN(DEPOSIT))
      .accountsStrict({
        marginAccount,
        owner,
      })
      .rpc();

    const margin = await program.account.marginAccount.fetch(marginAccount);
    assert.equal(margin.collateralBalance.toNumber(), DEPOSIT);
    assert.equal(margin.lockedCollateral.toNumber(), 0);

    const profile = await program.account.traderProfile.fetch(traderProfile);
    assert.equal(profile.reputationScore.toNumber(), 100); // STARTING_REPUTATION_SCORE
  });

  it("opens and closes a profitable long position", async () => {
    const positionId = 0;
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), owner.toBuffer(), u64Le(positionId)],
      program.programId
    );

    const COLLATERAL = 500;
    const LEVERAGE = 2;
    const ENTRY_PRICE = 10_000;
    const EXIT_PRICE = 11_000;
    // size = 500 * 2 = 1000
    // pnl  = (11000 - 10000) * 1000 / 10000 = 100

    await program.methods
      .openPosition(
        new anchor.BN(positionId),
        new anchor.BN(marketIndex),
        true, // long
        new anchor.BN(COLLATERAL),
        LEVERAGE
      )
      .accountsStrict({
        protocol,
        market,
        traderProfile,
        marginAccount,
        position,
        owner,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Verify collateral is locked
    let margin = await program.account.marginAccount.fetch(marginAccount);
    assert.equal(margin.lockedCollateral.toNumber(), COLLATERAL);

    // Move price up → profitable for long
    await program.methods
      .updateMarketPrice(new anchor.BN(marketIndex), new anchor.BN(EXIT_PRICE))
      .accountsStrict({ protocol, market, authority: owner })
      .rpc();

    await program.methods
      .closePosition(new anchor.BN(positionId), new anchor.BN(marketIndex))
      .accountsStrict({
        market,
        traderProfile,
        marginAccount,
        position,
        owner,
      })
      .rpc();

    const profile = await program.account.traderProfile.fetch(traderProfile);
    margin = await program.account.marginAccount.fetch(marginAccount);
    const closedPosition = await program.account.position.fetch(position);

    // Assertions
    assert.equal(profile.totalTrades.toNumber(), 1);
    assert.equal(profile.winningTrades.toNumber(), 1);
    assert.equal(profile.losingTrades.toNumber(), 0);
    assert.equal(profile.realizedPnl.toNumber(), 100); // +100 profit
    assert.equal(profile.avgLeverageX100.toNumber(), 200); // 2x = 200
    assert.equal(margin.collateralBalance.toNumber(), 1_100); // 1000 + 100 pnl
    assert.equal(margin.lockedCollateral.toNumber(), 0); // nothing locked
    assert.equal(closedPosition.isOpen, false);
  });

  it("cannot liquidate a healthy position", async () => {
    // Deposit fresh collateral and open a safe position
    await program.methods
      .depositCollateral(new anchor.BN(500))
      .accountsStrict({ marginAccount, owner })
      .rpc();

    const positionId = 1;
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), owner.toBuffer(), u64Le(positionId)],
      program.programId
    );

    await program.methods
      .openPosition(
        new anchor.BN(positionId),
        new anchor.BN(marketIndex),
        true,
        new anchor.BN(300),
        2
      )
      .accountsStrict({
        protocol,
        market,
        traderProfile,
        marginAccount,
        position,
        owner,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Attempt to liquidate immediately — should fail because position is healthy
    try {
      await program.methods
        .liquidatePosition(
          new anchor.BN(positionId),
          new anchor.BN(marketIndex)
        )
        .accountsStrict({
          market,
          traderProfile,
          marginAccount,
          position,
          trader: owner,
          liquidator: owner,
        })
        .rpc();
      assert.fail("Expected liquidation to fail on healthy position");
    } catch (err: any) {
      assert.include(err.toString(), "PositionNotLiquidatable");
    }

    // Clean up — close the healthy position so state is consistent for next test
    await program.methods
      .closePosition(new anchor.BN(positionId), new anchor.BN(marketIndex))
      .accountsStrict({ market, traderProfile, marginAccount, position, owner })
      .rpc();
  });

  it("liquidates an underwater position", async () => {
    // Ensure enough free collateral (current price is still 11_000 from prev test)
    await program.methods
      .depositCollateral(new anchor.BN(2_000))
      .accountsStrict({ marginAccount, owner })
      .rpc();

    const positionId = 2;
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), owner.toBuffer(), u64Le(positionId)],
      program.programId
    );

    // Current reputation tier allows 3x leverage.
    // Open long at current price (11_000), 3x leverage, 300 collateral.
    // size = 300 * 3 = 900
    // maintenance margin = 900 * 625 / 10000 = ~56.25
    // We'll crash price to 1_000 to guarantee liquidation.
    await program.methods
      .openPosition(
        new anchor.BN(positionId),
        new anchor.BN(marketIndex),
        true, // long
        new anchor.BN(300),
        3 // reputation-gated leverage
      )
      .accountsStrict({
        protocol,
        market,
        traderProfile,
        marginAccount,
        position,
        owner,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Crash the price so the position is deeply underwater
    await program.methods
      .updateMarketPrice(new anchor.BN(marketIndex), new anchor.BN(1_000))
      .accountsStrict({ protocol, market, authority: owner })
      .rpc();

    const profileBefore = await program.account.traderProfile.fetch(
      traderProfile
    );
    const liquidationsBefore = profileBefore.liquidations.toNumber();
    const tradesBefore = profileBefore.totalTrades.toNumber();

    await program.methods
      .liquidatePosition(new anchor.BN(positionId), new anchor.BN(marketIndex))
      .accountsStrict({
        market,
        traderProfile,
        marginAccount,
        position,
        trader: owner,
        liquidator: owner,
      })
      .rpc();

    const profile = await program.account.traderProfile.fetch(traderProfile);
    const liquidatedPosition = await program.account.position.fetch(position);

    assert.equal(profile.liquidations.toNumber(), liquidationsBefore + 1);
    assert.equal(profile.totalTrades.toNumber(), tradesBefore + 1);
    assert.equal(liquidatedPosition.isOpen, false);
  });

  it("withdraw collateral reduces balance correctly", async () => {
    const marginBefore = await program.account.marginAccount.fetch(
      marginAccount
    );
    const freeCollateral =
      marginBefore.collateralBalance.toNumber() -
      marginBefore.lockedCollateral.toNumber();

    if (freeCollateral <= 0) {
      console.log("    (skipping: no free collateral available)");
      return;
    }

    const WITHDRAW = Math.min(100, freeCollateral);
    await program.methods
      .withdrawCollateral(new anchor.BN(WITHDRAW))
      .accountsStrict({ marginAccount, owner })
      .rpc();

    const marginAfter = await program.account.marginAccount.fetch(
      marginAccount
    );
    assert.equal(
      marginAfter.collateralBalance.toNumber(),
      marginBefore.collateralBalance.toNumber() - WITHDRAW
    );
  });
});
