import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

const expandPath = (filePath: string) => {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/"))
    return path.join(os.homedir(), filePath.slice(2));
  return filePath;
};

const loadWallet = (walletPath: string) => {
  const resolvedPath = expandPath(walletPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Wallet file not found at ${resolvedPath}. Set ANCHOR_WALLET to your Solana keypair path.`
    );
  }

  const secretKey = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
};

export const getProvider = () => {
  const rpcUrl =
    process.env.ANCHOR_PROVIDER_URL ??
    process.env.SOLANA_URL ??
    process.env.RPC_URL ??
    "https://api.devnet.solana.com";
  const walletPath =
    process.env.ANCHOR_WALLET ??
    process.env.WALLET ??
    "~/.config/solana/id.json";
  const wallet = new anchor.Wallet(loadWallet(walletPath));

  return new anchor.AnchorProvider(
    new anchor.web3.Connection(rpcUrl, "confirmed"),
    wallet,
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    }
  );
};
