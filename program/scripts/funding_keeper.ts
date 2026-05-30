import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const u64Le = (value: number) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

const parseMarkets = () =>
  (process.env.MARKET_INDICES ?? "0")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);

async function crankOnce(program: anchor.Program, marketIndex: number) {
  const [protocol] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol")],
    program.programId
  );
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), u64Le(marketIndex)],
    program.programId
  );

  try {
    const signature = await (program.methods as any)
      .settleFunding(new anchor.BN(marketIndex))
      .accountsStrict({ protocol, market })
      .rpc();
    console.log(
      `[${new Date().toISOString()}] settled market ${marketIndex}: ${signature}`
    );
  } catch (error: any) {
    const message = error?.toString?.() ?? String(error);
    if (message.includes("FundingNotReady")) {
      console.log(
        `[${new Date().toISOString()}] market ${marketIndex}: funding not ready`
      );
      return;
    }
    throw error;
  }
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Reputex as anchor.Program;
  const markets = parseMarkets();
  const intervalMs = Number(process.env.KEEPER_INTERVAL_MS ?? "30000");
  const runForever = process.env.RUN_FOREVER === "true";

  if (markets.length === 0) {
    throw new Error("MARKET_INDICES did not contain any valid market index");
  }

  do {
    for (const marketIndex of markets) {
      await crankOnce(program, marketIndex);
    }

    if (!runForever) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (runForever);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
