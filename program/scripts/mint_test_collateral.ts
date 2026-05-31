import {
  PublicKey,
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
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const PROGRAM_ROOT = path.resolve(__dirname, "..");
const DEFAULT_AUTHORITY_PATH = path.join(
  PROGRAM_ROOT,
  ".devnet",
  "authority.json"
);
const DEFAULT_MINT_PATH = path.join(
  PROGRAM_ROOT,
  ".devnet",
  "collateral-mint.json"
);

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
};

const u64Le = (value: number | bigint) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

const associatedTokenAddress = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];

const createAssociatedTokenAccountInstruction = (
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
) => {
  const ata = associatedTokenAddress(owner, mint);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });
};

const mintToInstruction = (
  mint: PublicKey,
  destination: PublicKey,
  mintAuthority: PublicKey,
  amount: bigint
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

const collateralMint = () => {
  if (process.env.COLLATERAL_MINT)
    return new PublicKey(process.env.COLLATERAL_MINT);
  if (!fs.existsSync(DEFAULT_MINT_PATH)) {
    throw new Error(
      `No COLLATERAL_MINT provided and no generated mint found at ${DEFAULT_MINT_PATH}. Run bootstrap:devnet first.`
    );
  }

  const secretKey = JSON.parse(fs.readFileSync(DEFAULT_MINT_PATH, "utf8"));
  return new PublicKey(secretKey.slice(32));
};

const defaultSolanaWalletPath = () =>
  path.join(os.homedir(), ".config", "solana", "id.json");

const ensureWalletEnv = () => {
  if (process.env.ANCHOR_WALLET || process.env.WALLET) return;
  if (fs.existsSync(DEFAULT_AUTHORITY_PATH)) {
    process.env.ANCHOR_WALLET = DEFAULT_AUTHORITY_PATH;
    return;
  }
  if (fs.existsSync(defaultSolanaWalletPath())) return;
};

async function main() {
  ensureWalletEnv();
  const provider = getProvider();
  const mint = collateralMint();
  const recipientOwner = new PublicKey(env("RECIPIENT_OWNER"));
  const decimals = Number(env("COLLATERAL_DECIMALS", "6"));
  const uiAmount = Number(env("AMOUNT", "1000"));
  const amount = BigInt(Math.trunc(uiAmount * 10 ** decimals));
  const recipientAta = associatedTokenAddress(recipientOwner, mint);
  const tx = new Transaction();

  console.log(`Mint authority: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Collateral mint: ${mint.toBase58()}`);
  console.log(`Recipient ATA: ${recipientAta.toBase58()}`);

  if (!(await provider.connection.getAccountInfo(recipientAta))) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        recipientOwner,
        mint
      )
    );
  }

  tx.add(
    mintToInstruction(mint, recipientAta, provider.wallet.publicKey, amount)
  );

  const signature = await provider.sendAndConfirm(tx);
  console.log(
    `Minted ${uiAmount} collateral tokens to ${recipientAta.toBase58()}`
  );
  console.log(`Signature: ${signature}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
