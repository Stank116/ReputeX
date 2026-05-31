import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

import { getProvider } from "./provider";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const MINT_SIZE = 82;
const LAMPORTS_PER_SOL = 1_000_000_000;
const PROGRAM_ROOT = path.resolve(__dirname, "..");
const DEVNET_DIR = path.join(PROGRAM_ROOT, ".devnet");
const DEFAULT_AUTHORITY_PATH = path.join(DEVNET_DIR, "authority.json");
const DEFAULT_MINT_PATH = path.join(DEVNET_DIR, "collateral-mint.json");

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
};

const optionalEnv = (name: string) => {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
};

const expandPath = (filePath: string) => {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/"))
    return path.join(os.homedir(), filePath.slice(2));
  return filePath;
};

const defaultSolanaWalletPath = () =>
  path.join(os.homedir(), ".config", "solana", "id.json");

const ensureKeypair = (filePath: string) => {
  const resolvedPath = expandPath(filePath);
  if (fs.existsSync(resolvedPath)) {
    const secretKey = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const keypair = Keypair.generate();
  fs.writeFileSync(resolvedPath, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
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

const ensureDevnetWallet = () => {
  if (optionalEnv("ANCHOR_WALLET") || optionalEnv("WALLET")) return;
  if (fs.existsSync(defaultSolanaWalletPath())) return;

  const keypair = ensureKeypair(DEFAULT_AUTHORITY_PATH);
  process.env.ANCHOR_WALLET = DEFAULT_AUTHORITY_PATH;
  console.log(
    `Using generated devnet authority ${keypair.publicKey.toBase58()} (${DEFAULT_AUTHORITY_PATH})`
  );
};

const loadProgram = (provider: anchor.AnchorProvider) => {
  const idlPath = path.join(PROGRAM_ROOT, "target", "idl", "reputex.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}. Run anchor build first.`);
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  return new anchor.Program(idl, provider);
};

const fundWalletIfNeeded = async (provider: anchor.AnchorProvider) => {
  const minimumLamports =
    Number(env("MIN_AUTHORITY_SOL", "1")) * LAMPORTS_PER_SOL;
  const currentLamports = await provider.connection.getBalance(
    provider.wallet.publicKey
  );

  if (currentLamports >= minimumLamports) return;

  const requestedLamports = Number(env("AIRDROP_SOL", "2")) * LAMPORTS_PER_SOL;
  console.log(
    `Requesting ${(requestedLamports / LAMPORTS_PER_SOL).toFixed(
      2
    )} devnet SOL for ${provider.wallet.publicKey.toBase58()}`
  );
  const signature = await provider.connection.requestAirdrop(
    provider.wallet.publicKey,
    requestedLamports
  );
  const latestBlockhash = await provider.connection.getLatestBlockhash();
  await provider.connection.confirmTransaction(
    { signature, ...latestBlockhash },
    "confirmed"
  );
};

const ensureCollateralMint = async (provider: anchor.AnchorProvider) => {
  const providedMint = optionalEnv("COLLATERAL_MINT");
  if (providedMint) return new PublicKey(providedMint);

  const mintKeypair = ensureKeypair(DEFAULT_MINT_PATH);
  const existingMint = await provider.connection.getAccountInfo(
    mintKeypair.publicKey
  );
  if (existingMint) {
    console.log(
      `Collateral mint already exists ${mintKeypair.publicKey.toBase58()}`
    );
    return mintKeypair.publicKey;
  }

  const decimals = Number(env("COLLATERAL_DECIMALS", "6"));
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(
    MINT_SIZE
  );
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      lamports,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    initializeMintInstruction(
      mintKeypair.publicKey,
      decimals,
      provider.wallet.publicKey
    )
  );

  await provider.sendAndConfirm(tx, [mintKeypair]);
  console.log(`Created collateral mint ${mintKeypair.publicKey.toBase58()}`);
  return mintKeypair.publicKey;
};

async function main() {
  ensureDevnetWallet();
  const provider = getProvider();
  anchor.setProvider(provider);
  await fundWalletIfNeeded(provider);

  const program = loadProgram(provider);
  const authority = provider.wallet.publicKey;
  const collateralMint = await ensureCollateralMint(provider);
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

  console.log(`Authority: ${authority.toBase58()}`);
  console.log(`Collateral mint: ${collateralMint.toBase58()}`);
  console.log(`Protocol PDA: ${protocol.toBase58()}`);
  console.log(`Collateral vault PDA: ${collateralVault.toBase58()}`);
  console.log(`Market PDA: ${market.toBase58()}`);
  console.log("Bootstrap complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
