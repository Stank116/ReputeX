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
    .configureMarketOracle(
      new anchor.BN(0),
      Array(32).fill(0),
      new anchor.BN(30),
      new anchor.BN(100),
      0,
      false        // <-- oracle_enabled = false
    )
    .accountsStrict({ protocol, market, authority: provider.wallet.publicKey })
    .rpc();
  console.log("✅ Oracle disabled:", tx.slice(0, 20) + "...");
}
main().catch(console.error);
