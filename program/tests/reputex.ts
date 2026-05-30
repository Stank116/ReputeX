import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { assert } from "chai";
import { Reputex } from "../target/types/reputex";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;

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

  const initializeMintInstruction = (
    mint: PublicKey,
    decimals: number,
    mintAuthority: PublicKey
  ) =>
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        Buffer.from([0, decimals]),
        mintAuthority.toBuffer(),
        Buffer.alloc(36),
      ]),
    });

  const initializeTokenAccountInstruction = (
    account: PublicKey,
    mint: PublicKey,
    tokenOwner: PublicKey
  ) =>
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: account, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: tokenOwner, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    });

  const mintToInstruction = (
    mint: PublicKey,
    destination: PublicKey,
    mintAuthority: PublicKey,
    amount: number
  ) =>
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: mintAuthority, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from([7]), u64Le(amount)]),
    });

  const tokenBalance = async (tokenAccount: PublicKey) => {
    const balance = await provider.connection.getTokenAccountBalance(
      tokenAccount
    );
    return Number(balance.value.amount);
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

  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );

  const collateralMint = Keypair.generate();
  const ownerTokenAccount = Keypair.generate();

  before(async () => {
    const mintLamports =
      await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const tokenLamports =
      await provider.connection.getMinimumBalanceForRentExemption(
        TOKEN_ACCOUNT_SIZE
      );

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: owner,
        newAccountPubkey: collateralMint.publicKey,
        lamports: mintLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      initializeMintInstruction(collateralMint.publicKey, 6, owner),
      SystemProgram.createAccount({
        fromPubkey: owner,
        newAccountPubkey: ownerTokenAccount.publicKey,
        lamports: tokenLamports,
        space: TOKEN_ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      initializeTokenAccountInstruction(
        ownerTokenAccount.publicKey,
        collateralMint.publicKey,
        owner
      ),
      mintToInstruction(
        collateralMint.publicKey,
        ownerTokenAccount.publicKey,
        owner,
        10_000
      )
    );

    await provider.sendAndConfirm(tx, [collateralMint, ownerTokenAccount]);
  });

  // ── Tests ─────────────────────────────────────────────────────────────────

  it("initializes protocol and market", async () => {
    await program.methods
      .initializeProtocol()
      .accountsStrict({
        protocol,
        collateralMint: collateralMint.publicKey,
        collateralVault,
        authority: owner,
        tokenProgram: TOKEN_PROGRAM_ID,
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

  it("creates a trader profile and deposits SPL collateral", async () => {
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
        protocol,
        marginAccount,
        collateralVault,
        ownerTokenAccount: ownerTokenAccount.publicKey,
        owner,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const margin = await program.account.marginAccount.fetch(marginAccount);
    assert.equal(margin.collateralBalance.toNumber(), DEPOSIT);
    assert.equal(margin.lockedCollateral.toNumber(), 0);
    assert.equal(await tokenBalance(collateralVault), DEPOSIT);
    assert.equal(await tokenBalance(ownerTokenAccount.publicKey), 9_000);

    await program.methods
      .fundInsurance(new anchor.BN(1_000))
      .accountsStrict({
        protocol,
        collateralVault,
        funderTokenAccount: ownerTokenAccount.publicKey,
        funder: owner,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const protocolAccount = await program.account.protocol.fetch(protocol);
    assert.equal(protocolAccount.insuranceFundBalance.toNumber(), 1_000);
    assert.equal(await tokenBalance(collateralVault), 2_000);
    assert.equal(await tokenBalance(ownerTokenAccount.publicKey), 8_000);

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
    // price pnl = (11000 - 10000) * 1000 / 10000 = 100
    // funding pnl = -10 after a +100 bps cumulative funding update

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
      .updateFundingRate(new anchor.BN(marketIndex), new anchor.BN(100))
      .accountsStrict({ protocol, market, authority: owner })
      .rpc();

    await program.methods
      .closePosition(new anchor.BN(positionId), new anchor.BN(marketIndex))
      .accountsStrict({
        protocol,
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
    assert.equal(profile.realizedPnl.toNumber(), 90); // +100 price pnl - 10 funding
    assert.equal(profile.avgLeverageX100.toNumber(), 200); // 2x = 200
    assert.equal(margin.collateralBalance.toNumber(), 1_089); // 1000 - 1 fee + 90 net pnl
    assert.equal(margin.lockedCollateral.toNumber(), 0); // nothing locked
    assert.equal(closedPosition.isOpen, false);

    const protocolAccount = await program.account.protocol.fetch(protocol);
    assert.equal(protocolAccount.insuranceFundBalance.toNumber(), 911);
    assert.equal(protocolAccount.totalFeesCollected.toNumber(), 1);
  });

  it("cannot liquidate a healthy position", async () => {
    // Deposit fresh collateral and open a safe position
    await program.methods
      .depositCollateral(new anchor.BN(500))
      .accountsStrict({
        protocol,
        marginAccount,
        collateralVault,
        ownerTokenAccount: ownerTokenAccount.publicKey,
        owner,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
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
          protocol,
          market,
          traderProfile,
          marginAccount,
          position,
          trader: owner,
          liquidator: owner,
          collateralVault,
          liquidatorTokenAccount: ownerTokenAccount.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Expected liquidation to fail on healthy position");
    } catch (err: any) {
      assert.include(err.toString(), "PositionNotLiquidatable");
    }

    // Clean up — close the healthy position so state is consistent for next test
    await program.methods
      .closePosition(new anchor.BN(positionId), new anchor.BN(marketIndex))
      .accountsStrict({
        protocol,
        market,
        traderProfile,
        marginAccount,
        position,
        owner,
      })
      .rpc();
  });

  it("liquidates an underwater position", async () => {
    // Ensure enough free collateral (current price is still 11_000 from prev test)
    await program.methods
      .depositCollateral(new anchor.BN(2_000))
      .accountsStrict({
        protocol,
        marginAccount,
        collateralVault,
        ownerTokenAccount: ownerTokenAccount.publicKey,
        owner,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
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
        protocol,
        market,
        traderProfile,
        marginAccount,
        position,
        trader: owner,
        liquidator: owner,
        collateralVault,
        liquidatorTokenAccount: ownerTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
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
      .accountsStrict({
        protocol,
        marginAccount,
        collateralVault,
        ownerTokenAccount: ownerTokenAccount.publicKey,
        owner,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
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
