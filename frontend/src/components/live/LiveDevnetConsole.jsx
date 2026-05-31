import { useMemo, useState } from "react";

import { DEFAULT_IDL_PATH, DEFAULT_RPC_URL, DEFAULT_SOL_PYTH_PRICE_UPDATE, PROGRAM_ID } from "../../config/markets";
import { safeJson, shortKey } from "../../lib/format";
import {
  PublicKey,
  SystemProgram,
  TOKEN_PROGRAM_ID,
  Transaction,
  anchor,
  associatedTokenAddress,
  createAnchorProvider,
  createAssociatedTokenAccountInstruction,
  createProgram,
  deriveTradingPdas,
  fetchIdl,
} from "../../lib/solana";
import { Preview, Stat } from "../shared/Stat";
import { LiveInput } from "./LiveInput";

const initialForm = {
  rpcUrl: DEFAULT_RPC_URL,
  programId: PROGRAM_ID,
  idlPath: DEFAULT_IDL_PATH,
  ownerTokenAccount: "",
  priceUpdateAccount: DEFAULT_SOL_PYTH_PRICE_UPDATE,
  marketIndex: 0,
  positionId: 0,
  amount: 100,
  leverage: 2,
  side: "long",
};

export function LiveDevnetConsole() {
  const [wallet, setWallet] = useState(null);
  const [program, setProgram] = useState(null);
  const [provider, setProvider] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [stateOutput, setStateOutput] = useState("Load the program to begin.");
  const [logs, setLogs] = useState([]);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const programKey = useMemo(() => {
    try {
      return new PublicKey(form.programId);
    } catch {
      return null;
    }
  }, [form.programId]);

  const log = (message) => {
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setLogs((entries) => [`${stamp} - ${message}`, ...entries].slice(0, 16));
  };

  const connectWallet = async () => {
    if (!window.solana?.isPhantom) throw new Error("Phantom wallet not found");
    const response = await window.solana.connect();
    setWallet(window.solana);
    log(`Wallet connected ${response.publicKey.toBase58()}`);
    return window.solana;
  };

  const loadProgram = async () => {
    const connectedWallet = wallet ?? (await connectWallet());
    if (!programKey) throw new Error("Program ID is invalid");
    const nextProvider = createAnchorProvider(form.rpcUrl, connectedWallet);
    const idl = await fetchIdl(form.idlPath);
    const nextProgram = createProgram(idl, form.programId, nextProvider);
    setProvider(nextProvider);
    setProgram(nextProgram);
    log(`Loaded program ${nextProgram.programId.toBase58()}`);
    await refreshState(nextProgram, connectedWallet);
  };

  const derivePdas = (targetProgram = program, targetWallet = wallet, overrides = {}) => {
    if (!targetProgram || !targetWallet) throw new Error("Load the program first");
    return deriveTradingPdas(
      targetProgram.programId,
      targetWallet.publicKey,
      Number(overrides.marketIndex ?? form.marketIndex),
      Number(overrides.positionId ?? form.positionId)
    );
  };

  const refreshState = async (targetProgram = program, targetWallet = wallet) => {
    if (!targetProgram || !targetWallet) throw new Error("Load the program first");
    let accounts = derivePdas(targetProgram, targetWallet);
    const output = {};

    const setDerivedOutput = (derivedAccounts) => {
      for (const [name, pubkey] of Object.entries(derivedAccounts)) {
        output[`${name}Pda`] = pubkey.toBase58();
      }
    };

    try {
      output.protocol = await targetProgram.account.protocol.fetch(accounts.protocol);
    } catch {
      output.protocol = "not initialized";
    }

    if (output.protocol !== "not initialized") {
      const collateralMint = new PublicKey(output.protocol.collateralMint);
      const ownerAta = associatedTokenAddress(accounts.owner, collateralMint);
      const nextPositionId = Number(output.protocol.nextPositionId.toString());
      output.ownerAssociatedTokenAccount = ownerAta.toBase58();
      if (Number(form.positionId) === 0 && nextPositionId > 0) {
        accounts = derivePdas(targetProgram, targetWallet, { positionId: nextPositionId });
      }
      setForm((current) => ({
        ...current,
        ownerTokenAccount: current.ownerTokenAccount || ownerAta.toBase58(),
        positionId: Number(current.positionId) === 0 && nextPositionId > 0 ? nextPositionId : current.positionId,
      }));
    }

    setDerivedOutput(accounts);

    for (const [name, fetcher] of [
      ["market", () => targetProgram.account.market.fetch(accounts.market)],
      ["profile", () => targetProgram.account.traderProfile.fetch(accounts.traderProfile)],
      ["margin", () => targetProgram.account.marginAccount.fetch(accounts.marginAccount)],
      ["position", () => targetProgram.account.position.fetch(accounts.position)],
    ]) {
      try {
        output[name] = await fetcher();
      } catch {
        output[name] = "not initialized";
      }
    }

    setStateOutput(safeJson(output));
  };

  const send = async (label, builder) => {
    if (!program || !provider) throw new Error("Load the program first");
    const transactionBuilder = await builder();
    const signature = await transactionBuilder.rpc();
    log(`${label}: ${signature}`);
    await refreshState();
  };

  const sendTransaction = async (label, builder) => {
    if (!program || !provider) throw new Error("Load the program first");
    const transaction = await builder();
    if (transaction.instructions.length === 0) {
      await refreshState();
      return;
    }
    const signature = await provider.sendAndConfirm(transaction);
    log(`${label}: ${signature}`);
    await refreshState();
  };

  const createOwnerTokenAccount = async () =>
    sendTransaction("create owner token account", async () => {
      const accounts = derivePdas();
      const protocolAccount = await program.account.protocol.fetch(accounts.protocol);
      const collateralMint = new PublicKey(protocolAccount.collateralMint);
      const ownerAta = associatedTokenAddress(accounts.owner, collateralMint);
      setField("ownerTokenAccount", ownerAta.toBase58());
      const existing = await provider.connection.getAccountInfo(ownerAta);
      if (existing) {
        log(`Owner token account already exists ${ownerAta.toBase58()}`);
        return new Transaction();
      }
      return new Transaction().add(createAssociatedTokenAccountInstruction(accounts.owner, accounts.owner, collateralMint));
    });

  const withPythRefresh = async (transactionBuilder, accounts) => {
    if (!form.priceUpdateAccount.trim()) return transactionBuilder;
    const refreshIx = await program.methods
      .updateMarketPriceFromPyth(liveMarketIndex())
      .accountsStrict({
        protocol: accounts.protocol,
        market: accounts.market,
        priceUpdate: new PublicKey(form.priceUpdateAccount),
      })
      .instruction();
    return transactionBuilder.preInstructions([refreshIx]);
  };

  const liveAmount = () => new anchor.BN(Math.trunc(Number(form.amount)));
  const livePositionId = () => new anchor.BN(Math.trunc(Number(form.positionId)));
  const liveMarketIndex = () => new anchor.BN(Math.trunc(Number(form.marketIndex)));

  const run = (action) => action().catch((error) => log(error.message));

  return (
    <section className="live-grid">
      <section className="live-panel live-controls" aria-label="Live controls">
        <div className="panel-heading inline">
          <h2>Devnet Console</h2>
          <span className={program ? "status-pill live" : "status-pill"}>{program ? "IDL loaded" : "Offline"}</span>
        </div>

        <div className="devnet-summary">
          <Stat label="Wallet" value={shortKey(wallet?.publicKey)} />
          <Stat label="Program" value={programKey ? shortKey(programKey) : "Invalid"} tone={programKey ? "up" : "down"} />
          <Stat label="Cluster" value="Devnet" />
        </div>

        <div className="live-form">
          <LiveInput label="RPC URL" value={form.rpcUrl} onChange={(value) => setField("rpcUrl", value)} />
          <LiveInput label="Program ID" value={form.programId} onChange={(value) => setField("programId", value)} />
          <LiveInput label="IDL path" value={form.idlPath} onChange={(value) => setField("idlPath", value)} />
          <LiveInput
            label="Owner token account"
            value={form.ownerTokenAccount}
            onChange={(value) => setField("ownerTokenAccount", value)}
            placeholder="SPL collateral token account"
          />
          <LiveInput
            label="Pyth price update"
            value={form.priceUpdateAccount}
            onChange={(value) => setField("priceUpdateAccount", value)}
            placeholder="PriceUpdateV2 account"
          />
          <LiveInput label="Market index" type="number" value={form.marketIndex} onChange={(value) => setField("marketIndex", value)} />
          <LiveInput label="Position ID" type="number" value={form.positionId} onChange={(value) => setField("positionId", value)} />
          <LiveInput label="Amount / collateral" type="number" value={form.amount} onChange={(value) => setField("amount", value)} />
          <LiveInput label="Leverage" type="number" value={form.leverage} onChange={(value) => setField("leverage", value)} />
          <label>
            Side
            <select value={form.side} onChange={(event) => setField("side", event.target.value)}>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </label>
        </div>

        <div className="live-actions">
          <button className="primary-action" type="button" onClick={() => run(connectWallet)}>
            Connect Phantom
          </button>
          <button className="primary-action" type="button" onClick={() => run(loadProgram)}>
            Load Program
          </button>
          <button type="button" onClick={() => run(refreshState)}>
            Refresh
          </button>
          <button type="button" onClick={() => run(createOwnerTokenAccount)}>
            Create Token Account
          </button>
          <button
            type="button"
            onClick={() =>
              run(() =>
                send("create profile", () => {
                  const accounts = derivePdas();
                  return program.methods.createTraderProfile().accountsStrict({
                    protocol: accounts.protocol,
                    traderProfile: accounts.traderProfile,
                    marginAccount: accounts.marginAccount,
                    owner: accounts.owner,
                    systemProgram: SystemProgram.programId,
                  });
                })
              )
            }
          >
            Create Profile
          </button>
          <button
            type="button"
            onClick={() =>
              run(() =>
                send("deposit", () => {
                  const accounts = derivePdas();
                  return program.methods.depositCollateral(liveAmount()).accountsStrict({
                    protocol: accounts.protocol,
                    marginAccount: accounts.marginAccount,
                    collateralVault: accounts.collateralVault,
                    ownerTokenAccount: new PublicKey(form.ownerTokenAccount),
                    owner: accounts.owner,
                    tokenProgram: TOKEN_PROGRAM_ID,
                  });
                })
              )
            }
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={() =>
              run(() =>
                send("withdraw", () => {
                  const accounts = derivePdas();
                  return program.methods.withdrawCollateral(liveAmount()).accountsStrict({
                    protocol: accounts.protocol,
                    marginAccount: accounts.marginAccount,
                    collateralVault: accounts.collateralVault,
                    ownerTokenAccount: new PublicKey(form.ownerTokenAccount),
                    owner: accounts.owner,
                    tokenProgram: TOKEN_PROGRAM_ID,
                  });
                })
              )
            }
          >
            Withdraw
          </button>
          <button
            type="button"
            onClick={() =>
              run(() =>
                send("refresh pyth price", () => {
                  const accounts = derivePdas();
                  return program.methods.updateMarketPriceFromPyth(liveMarketIndex()).accountsStrict({
                    protocol: accounts.protocol,
                    market: accounts.market,
                    priceUpdate: new PublicKey(form.priceUpdateAccount),
                  });
                })
              )
            }
          >
            Refresh Pyth
          </button>
          <button
            type="button"
            onClick={() =>
              run(() =>
                send("settle funding", () => {
                  const accounts = derivePdas();
                  return program.methods.settleFunding(liveMarketIndex()).accountsStrict({
                    protocol: accounts.protocol,
                    market: accounts.market,
                  });
                })
              )
            }
          >
            Settle Funding
          </button>
          <button
            type="button"
            onClick={() =>
              run(() =>
                send("open position", async () => {
                  const accounts = derivePdas();
                  const tx = program.methods
                    .openPosition(livePositionId(), liveMarketIndex(), form.side === "long", liveAmount(), Number(form.leverage))
                    .accountsStrict({
                      protocol: accounts.protocol,
                      market: accounts.market,
                      traderProfile: accounts.traderProfile,
                      marginAccount: accounts.marginAccount,
                      position: accounts.position,
                      owner: accounts.owner,
                      systemProgram: SystemProgram.programId,
                    });
                  return withPythRefresh(tx, accounts);
                })
              )
            }
          >
            Open
          </button>
          <button
            type="button"
            onClick={() =>
              run(() =>
                send("close position", async () => {
                  const accounts = derivePdas();
                  const tx = program.methods.closePosition(livePositionId(), liveMarketIndex()).accountsStrict({
                    protocol: accounts.protocol,
                    market: accounts.market,
                    traderProfile: accounts.traderProfile,
                    marginAccount: accounts.marginAccount,
                    position: accounts.position,
                    owner: accounts.owner,
                  });
                  return withPythRefresh(tx, accounts);
                })
              )
            }
          >
            Close
          </button>
          <button
            type="button"
            onClick={() =>
              run(() =>
                send("liquidate position", async () => {
                  const accounts = derivePdas();
                  const tx = program.methods.liquidatePosition(livePositionId(), liveMarketIndex()).accountsStrict({
                    protocol: accounts.protocol,
                    market: accounts.market,
                    traderProfile: accounts.traderProfile,
                    marginAccount: accounts.marginAccount,
                    position: accounts.position,
                    trader: accounts.owner,
                    liquidator: accounts.owner,
                    collateralVault: accounts.collateralVault,
                    liquidatorTokenAccount: new PublicKey(form.ownerTokenAccount),
                    tokenProgram: TOKEN_PROGRAM_ID,
                  });
                  return withPythRefresh(tx, accounts);
                })
              )
            }
          >
            Liquidate
          </button>
        </div>
      </section>

      <section className="live-panel" aria-label="Live state">
        <div className="panel-heading inline">
          <h2>Program State</h2>
          <Preview label="Market" value={form.marketIndex} />
        </div>
        <pre className="live-state">{stateOutput}</pre>
        <div className="panel-heading inline live-log-title">
          <h2>Transaction Log</h2>
          <span>{logs.length} events</span>
        </div>
        <div className="live-log">
          {logs.length === 0 ? <span>No transactions in this browser session</span> : logs.map((entry, index) => <div key={`${entry}-${index}`}>{entry}</div>)}
        </div>
      </section>
    </section>
  );
}
