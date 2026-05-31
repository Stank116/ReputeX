import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { getProvider } from "./provider";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
};

const u64Le = (value: number) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

const feedIdBytes = (feedId: string) => {
  const normalized = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  const bytes = Buffer.from(normalized, "hex");
  if (bytes.length !== 32) {
    throw new Error("PYTH_FEED_ID must be a 32-byte hex string");
  }
  return Array.from(bytes);
};

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);

  const program = anchor.workspace.Reputex as anchor.Program;
  const authority = provider.wallet.publicKey;
  const collateralMint = new PublicKey(env("COLLATERAL_MINT"));
  const marketIndex = Number(env("MARKET_INDEX", "0"));
  const symbol = env("MARKET_SYMBOL", "SOL-PERP");
  const initialPrice = Number(env("INITIAL_PRICE", "100000000"));

  const [protocol] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol")],
    program.programId
  );
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), u64Le(marketIndex)],
    program.programId
  );

  if (!(await provider.connection.getAccountInfo(protocol))) {
    await (program.methods as any)
      .initializeProtocol()
      .accountsStrict({
        protocol,
        collateralMint,
        collateralVault,
        authority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`Initialized protocol ${protocol.toBase58()}`);
  } else {
    console.log(`Protocol already exists ${protocol.toBase58()}`);
  }

  if (!(await provider.connection.getAccountInfo(market))) {
    await (program.methods as any)
      .initializeMarket(
        new anchor.BN(marketIndex),
        symbol,
        new anchor.BN(initialPrice)
      )
      .accountsStrict({
        protocol,
        market,
        authority,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`Initialized market ${symbol} (${market.toBase58()})`);
  } else {
    console.log(`Market already exists ${market.toBase58()}`);
  }

  if (process.env.PYTH_FEED_ID) {
    await (program.methods as any)
      .configureMarketOracle(
        new anchor.BN(marketIndex),
        feedIdBytes(process.env.PYTH_FEED_ID),
        new anchor.BN(Number(env("ORACLE_MAX_AGE_SECONDS", "30"))),
        new anchor.BN(Number(env("ORACLE_MAX_CONFIDENCE_BPS", "100"))),
        Number(env("PRICE_DECIMALS", "6")),
        true
      )
      .accountsStrict({ protocol, market, authority })
      .rpc();
    console.log(`Enabled Pyth oracle for ${symbol}`);
  }

  console.log("Bootstrap complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
