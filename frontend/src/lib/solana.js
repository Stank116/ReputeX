import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

export { anchor, Connection, PublicKey, SystemProgram, Transaction };

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export function u64Le(value) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, BigInt(value), true);
  return new Uint8Array(buffer);
}

export function associatedTokenAddress(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

export function createAssociatedTokenAccountInstruction(payer, owner, mint) {
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
    data: new Uint8Array(),
  });
}

export function deriveProtocolPdas(programId) {
  const [protocol] = PublicKey.findProgramAddressSync([new TextEncoder().encode("protocol")], programId);
  const [collateralVault] = PublicKey.findProgramAddressSync([new TextEncoder().encode("vault")], programId);
  return { protocol, collateralVault };
}

export function deriveTradingPdas(programId, owner, marketIndex, positionId) {
  const { protocol, collateralVault } = deriveProtocolPdas(programId);
  const [market] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("market"), u64Le(marketIndex)],
    programId
  );
  const [traderProfile] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("trader"), owner.toBuffer()],
    programId
  );
  const [marginAccount] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("margin"), owner.toBuffer()],
    programId
  );
  const [position] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("position"), owner.toBuffer(), u64Le(positionId)],
    programId
  );

  return {
    protocol,
    collateralVault,
    market,
    traderProfile,
    marginAccount,
    position,
    owner,
  };
}

export async function fetchIdl(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load IDL from ${path}`);
  return response.json();
}

export function createAnchorProvider(rpcUrl, wallet) {
  return new anchor.AnchorProvider(new Connection(rpcUrl, "confirmed"), wallet, {
    commitment: "confirmed",
  });
}

export function createProgram(idl, programId, provider) {
  return new anchor.Program({ ...idl, address: programId }, provider);
}
