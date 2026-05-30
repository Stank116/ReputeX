import * as anchor from "https://esm.sh/@coral-xyz/anchor@0.32.1";
import {
  PublicKey,
  SystemProgram,
  Connection,
} from "https://esm.sh/@solana/web3.js@1.98.4";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

const el = (id) => document.getElementById(id);
const log = (message) => {
  const stamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  el("logOutput").textContent = `${stamp} - ${message}\n${
    el("logOutput").textContent
  }`;
};

const u64Le = (value) => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, BigInt(value), true);
  return new Uint8Array(buffer);
};

let provider;
let program;
let wallet;

function requireProgram() {
  if (!program || !provider) throw new Error("Load the program first");
}

function marketIndex() {
  return Number(el("marketIndex").value);
}

function amount() {
  return new anchor.BN(Number(el("amount").value));
}

function positionId() {
  return new anchor.BN(Number(el("positionId").value));
}

function pdas() {
  const owner = wallet.publicKey;
  const index = marketIndex();
  const [protocol] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("protocol")],
    program.programId
  );
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("vault")],
    program.programId
  );
  const [market] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("market"), u64Le(index)],
    program.programId
  );
  const [traderProfile] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("trader"), owner.toBuffer()],
    program.programId
  );
  const [marginAccount] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("margin"), owner.toBuffer()],
    program.programId
  );
  const [position] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("position"),
      owner.toBuffer(),
      u64Le(Number(el("positionId").value)),
    ],
    program.programId
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

async function connectWallet() {
  if (!window.solana?.isPhantom) throw new Error("Phantom wallet not found");
  const response = await window.solana.connect();
  wallet = window.solana;
  el("walletState").textContent = `${response.publicKey
    .toBase58()
    .slice(0, 4)}...${response.publicKey.toBase58().slice(-4)}`;
  log("Wallet connected");
}

async function loadProgram() {
  if (!wallet) await connectWallet();

  const connection = new Connection(el("rpcUrl").value, "confirmed");
  provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const idl = await fetch(el("idlPath").value).then((response) =>
    response.json()
  );
  idl.address = el("programId").value;
  program = new anchor.Program(idl, provider);
  log(`Loaded program ${program.programId.toBase58()}`);
  await refreshState();
}

async function refreshState() {
  requireProgram();
  const accounts = pdas();
  const output = {};

  for (const [name, pubkey] of Object.entries(accounts)) {
    output[`${name}Pda`] = pubkey.toBase58();
  }

  for (const [name, fetcher] of [
    ["protocol", () => program.account.protocol.fetch(accounts.protocol)],
    ["market", () => program.account.market.fetch(accounts.market)],
    [
      "profile",
      () => program.account.traderProfile.fetch(accounts.traderProfile),
    ],
    [
      "margin",
      () => program.account.marginAccount.fetch(accounts.marginAccount),
    ],
  ]) {
    try {
      output[name] = await fetcher();
    } catch {
      output[name] = "not initialized";
    }
  }

  el("stateOutput").textContent = JSON.stringify(output, null, 2);
}

async function send(label, builder) {
  requireProgram();
  const signature = await builder().rpc();
  log(`${label}: ${signature}`);
  await refreshState();
}

el("connectWallet").addEventListener("click", () =>
  connectWallet().catch((error) => log(error.message))
);
el("loadProgram").addEventListener("click", () =>
  loadProgram().catch((error) => log(error.message))
);
el("refreshState").addEventListener("click", () =>
  refreshState().catch((error) => log(error.message))
);

el("createProfile").addEventListener("click", () =>
  send("create profile", () => {
    const a = pdas();
    return program.methods.createTraderProfile().accountsStrict({
      protocol: a.protocol,
      traderProfile: a.traderProfile,
      marginAccount: a.marginAccount,
      owner: a.owner,
      systemProgram: SystemProgram.programId,
    });
  }).catch((error) => log(error.message))
);

el("deposit").addEventListener("click", () =>
  send("deposit", () => {
    const a = pdas();
    return program.methods.depositCollateral(amount()).accountsStrict({
      protocol: a.protocol,
      marginAccount: a.marginAccount,
      collateralVault: a.collateralVault,
      ownerTokenAccount: new PublicKey(el("ownerTokenAccount").value),
      owner: a.owner,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
  }).catch((error) => log(error.message))
);

el("withdraw").addEventListener("click", () =>
  send("withdraw", () => {
    const a = pdas();
    return program.methods.withdrawCollateral(amount()).accountsStrict({
      protocol: a.protocol,
      marginAccount: a.marginAccount,
      collateralVault: a.collateralVault,
      ownerTokenAccount: new PublicKey(el("ownerTokenAccount").value),
      owner: a.owner,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
  }).catch((error) => log(error.message))
);

el("openPosition").addEventListener("click", () =>
  send("open position", () => {
    const a = pdas();
    return program.methods
      .openPosition(
        positionId(),
        new anchor.BN(marketIndex()),
        el("side").value === "long",
        amount(),
        Number(el("leverage").value)
      )
      .accountsStrict({
        protocol: a.protocol,
        market: a.market,
        traderProfile: a.traderProfile,
        marginAccount: a.marginAccount,
        position: a.position,
        owner: a.owner,
        systemProgram: SystemProgram.programId,
      });
  }).catch((error) => log(error.message))
);

el("closePosition").addEventListener("click", () =>
  send("close position", () => {
    const a = pdas();
    return program.methods
      .closePosition(positionId(), new anchor.BN(marketIndex()))
      .accountsStrict({
        protocol: a.protocol,
        market: a.market,
        traderProfile: a.traderProfile,
        marginAccount: a.marginAccount,
        position: a.position,
        owner: a.owner,
      });
  }).catch((error) => log(error.message))
);
