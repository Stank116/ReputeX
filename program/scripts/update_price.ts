import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { getProvider } from "./provider";

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../target/idl/reputex.json"), "utf8"));
  const program = new anchor.Program(idl, provider);
  const pid = program.programId;

  const [protocol] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol")], pid);
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.alloc(8)], pid);

  const tx = await (program.methods as any)
    .updateMarketPrice(new anchor.BN(0), new anchor.BN(100_000_000))
    .accountsStrict({
      protocol,
      market,
      authority: provider.wallet.publicKey
    })
    .rpc();
  console.log("Price updated:", tx.slice(0, 20) + "...");
  console.log("Full signature:", tx);
}
main().catch(console.error);
