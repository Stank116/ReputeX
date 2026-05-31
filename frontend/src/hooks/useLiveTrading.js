import { useCallback, useEffect, useMemo, useState } from "react";

import { DEFAULT_IDL_PATH, DEFAULT_RPC_URL, DEFAULT_SOL_PYTH_PRICE_UPDATE, PROGRAM_ID } from "../config/markets";
import { shortKey } from "../lib/format";
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
} from "../lib/solana";

const toNumber = (value, fallback = 0) => Number(value?.toString?.() ?? value ?? fallback);
const positiveWhole = (value, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return parsed;
};

const friendlyError = (error) => {
  const message = error?.message ?? error?.toString?.() ?? String(error);
  if (message.includes("User rejected")) return "Wallet rejected the transaction.";
  if (message.includes("Unexpected error")) return "Unlock Phantom, switch to Devnet, and retry.";
  if (message.includes("insufficient")) return "Insufficient SOL, token balance, or collateral.";
  if (message.includes("Account does not exist")) return "Account missing. Create profile and token account first.";
  if (message.includes("InvalidPositionId")) return "Position ID changed. Refresh and try again.";
  if (message.includes("InvalidLeverage")) return "Leverage is above your reputation or market limit.";
  if (message.includes("InitialMarginTooLow")) return "Collateral is too low for this leverage.";
  if (message.includes("PriceTooOld")) return "Market price is stale. Refresh Pyth/market first.";
  if (message.includes("ManualPriceUpdateDisabled")) return "This market expects oracle pricing.";
  return message.replace(/^Error:\s*/, "");
};

export function getPhantomProvider() {
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solana?.isPhantom) return window.solana;
  if (Array.isArray(window.solana?.providers)) {
    return window.solana.providers.find((provider) => provider.isPhantom) ?? null;
  }
  return null;
}

export function useLiveTrading() {
  const [wallet, setWallet] = useState(null);
  const [program, setProgram] = useState(null);
  const [provider, setProvider] = useState(null);
  const [walletStatus, setWalletStatus] = useState("Checking Phantom...");
  const [status, setStatus] = useState("Connect Phantom to trade on devnet.");
  const [busyAction, setBusyAction] = useState("");
  const [protocol, setProtocol] = useState(null);
  const [market, setMarket] = useState(null);
  const [profile, setProfile] = useState(null);
  const [marginAccount, setMarginAccount] = useState(null);
  const [ownerTokenAccount, setOwnerTokenAccount] = useState("");
  const [tokenBalance, setTokenBalance] = useState("not loaded");
  const [positions, setPositions] = useState([]);
  const [activity, setActivity] = useState([]);

  const programId = useMemo(() => new PublicKey(PROGRAM_ID), []);

  const log = useCallback((message) => {
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setActivity((entries) => [`${stamp} - ${message}`, ...entries].slice(0, 12));
  }, []);

  const waitForPhantomProvider = useCallback(async () => {
    const existing = getPhantomProvider();
    if (existing) return existing;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    return getPhantomProvider();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const detect = async () => {
      const phantom = await waitForPhantomProvider();
      if (cancelled) return;
      if (!phantom) {
        setWalletStatus("Phantom not detected");
        setStatus("Install Phantom, open this site in Chrome/Brave, then refresh.");
        return;
      }

      setWalletStatus(phantom.isConnected && phantom.publicKey ? `Connected ${shortKey(phantom.publicKey)}` : "Phantom detected");
      if (phantom.isConnected && phantom.publicKey) setWallet(phantom);

      phantom.on?.("connect", (publicKey) => {
        setWallet(phantom);
        setWalletStatus(`Connected ${shortKey(publicKey)}`);
      });
      phantom.on?.("disconnect", () => {
        setWallet(null);
        setProgram(null);
        setProvider(null);
        setWalletStatus("Wallet disconnected");
        setStatus("Wallet disconnected.");
      });
      phantom.on?.("accountChanged", (publicKey) => {
        if (!publicKey) {
          setWallet(null);
          setWalletStatus("Wallet locked");
          setStatus("Wallet locked or disconnected.");
          return;
        }
        setWallet(phantom);
        setWalletStatus(`Connected ${shortKey(publicKey)}`);
      });
    };

    detect();
    return () => {
      cancelled = true;
    };
  }, [waitForPhantomProvider]);

  const connectWallet = useCallback(async () => {
    const phantom = await waitForPhantomProvider();
    if (!phantom) throw new Error("Phantom wallet not found.");
    setBusyAction("connect wallet");
    setStatus("Waiting for Phantom approval...");
    try {
      const response = await phantom.connect({ onlyIfTrusted: false });
      setWallet(phantom);
      setWalletStatus(`Connected ${shortKey(response.publicKey)}`);
      setStatus("Wallet connected. Load the program or place a trade to continue.");
      log(`Wallet connected ${response.publicKey.toBase58()}`);
      return phantom;
    } catch (error) {
      const message = friendlyError(error);
      setStatus(message);
      throw new Error(message);
    } finally {
      setBusyAction("");
    }
  }, [log, waitForPhantomProvider]);

  const disconnectWallet = useCallback(async () => {
    const phantom = wallet ?? getPhantomProvider();
    try {
      await phantom?.disconnect?.();
    } finally {
      setWallet(null);
      setProgram(null);
      setProvider(null);
      setProtocol(null);
      setMarket(null);
      setProfile(null);
      setMarginAccount(null);
      setOwnerTokenAccount("");
      setTokenBalance("not loaded");
      setPositions([]);
      setWalletStatus("Wallet disconnected");
      setStatus("Wallet disconnected.");
      log("Wallet disconnected");
    }
  }, [log, wallet]);

  const loadProgram = useCallback(
    async (targetWallet = wallet) => {
      const activeWallet = targetWallet ?? (await connectWallet());
      setBusyAction("load program");
      setStatus("Loading ReputeX devnet program...");
      try {
        const nextProvider = createAnchorProvider(DEFAULT_RPC_URL, activeWallet);
        const idl = await fetchIdl(DEFAULT_IDL_PATH);
        const nextProgram = createProgram(idl, PROGRAM_ID, nextProvider);
        setProvider(nextProvider);
        setProgram(nextProgram);
        setStatus("Program loaded.");
        log(`Program loaded ${shortKey(PROGRAM_ID)}`);
        return { nextProgram, nextProvider, activeWallet };
      } catch (error) {
        const message = friendlyError(error);
        setStatus(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [connectWallet, log, wallet]
  );

  const pdaFor = useCallback(
    (targetProgram, targetWallet, marketIndex = 0, positionId = 0) =>
      deriveTradingPdas(targetProgram.programId, targetWallet.publicKey, Number(marketIndex), Number(positionId)),
    []
  );

  const refresh = useCallback(
    async (options = {}) => {
      const activeWallet = options.wallet ?? wallet;
      let activeProgram = options.program ?? program;
      if (!activeWallet) return;
      if (!activeProgram) {
        const loaded = await loadProgram(activeWallet);
        activeProgram = loaded.nextProgram;
      }

      setBusyAction("refresh accounts");
      try {
        const accounts = pdaFor(activeProgram, activeWallet, options.marketIndex ?? 0, options.positionId ?? 0);
        const output = {
          protocol: null,
          market: null,
          profile: null,
          margin: null,
        };

        try {
          output.protocol = await activeProgram.account.protocol.fetch(accounts.protocol);
          setProtocol(output.protocol);
        } catch {
          setProtocol(null);
        }

        try {
          output.market = await activeProgram.account.market.fetch(accounts.market);
          setMarket(output.market);
        } catch {
          setMarket(null);
        }

        try {
          output.profile = await activeProgram.account.traderProfile.fetch(accounts.traderProfile);
          setProfile(output.profile);
        } catch {
          setProfile(null);
        }

        try {
          output.margin = await activeProgram.account.marginAccount.fetch(accounts.marginAccount);
          setMarginAccount(output.margin);
        } catch {
          setMarginAccount(null);
        }

        if (output.protocol) {
          const mint = new PublicKey(output.protocol.collateralMint);
          const ata = associatedTokenAddress(accounts.owner, mint);
          setOwnerTokenAccount(ata.toBase58());
          try {
            const balance = await activeProgram.provider.connection.getTokenAccountBalance(ata);
            setTokenBalance(balance.value.uiAmountString ?? balance.value.amount);
          } catch {
            setTokenBalance("token account missing");
          }
        }

        try {
          const owner = activeWallet.publicKey.toBase58();
          const allPositions = await activeProgram.account.position.all();
          setPositions(
            allPositions
              .map((entry) => entry.account)
              .filter((position) => position.owner?.toBase58?.() === owner && position.isOpen)
              .sort((a, b) => toNumber(b.positionId) - toNumber(a.positionId))
          );
        } catch {
          setPositions([]);
        }

        setStatus("Live devnet state refreshed.");
      } catch (error) {
        const message = friendlyError(error);
        setStatus(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [loadProgram, pdaFor, program, wallet]
  );

  const connectAndLoad = useCallback(async () => {
    const activeWallet = wallet ?? (await connectWallet());
    const { nextProgram } = await loadProgram(activeWallet);
    await refresh({ wallet: activeWallet, program: nextProgram });
  }, [connectWallet, loadProgram, refresh, wallet]);

  const send = useCallback(
    async (label, builder) => {
      let activeWallet = wallet;
      let activeProgram = program;
      if (!activeWallet) activeWallet = await connectWallet();
      if (!activeProgram) {
        const loaded = await loadProgram(activeWallet);
        activeProgram = loaded.nextProgram;
      }
      setBusyAction(label);
      setStatus(`${label}: waiting for Phantom...`);
      try {
        const txBuilder = await builder(activeProgram, activeWallet);
        const signature = await txBuilder.rpc();
        log(`${label}: ${signature}`);
        setStatus(`${label} confirmed.`);
        await refresh({ wallet: activeWallet, program: activeProgram });
        return signature;
      } catch (error) {
        const message = friendlyError(error);
        setStatus(message);
        log(`${label}: ${message}`);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [connectWallet, loadProgram, log, program, refresh, wallet]
  );

  const sendTransaction = useCallback(
    async (label, builder) => {
      let activeWallet = wallet;
      let activeProgram = program;
      let activeProvider = provider;
      if (!activeWallet) activeWallet = await connectWallet();
      if (!activeProgram || !activeProvider) {
        const loaded = await loadProgram(activeWallet);
        activeProgram = loaded.nextProgram;
        activeProvider = loaded.nextProvider;
      }
      setBusyAction(label);
      setStatus(`${label}: waiting for Phantom...`);
      try {
        const tx = await builder(activeProgram, activeWallet);
        const signature = tx.instructions.length ? await activeProvider.sendAndConfirm(tx) : "already-created";
        log(`${label}: ${signature}`);
        setStatus(`${label} confirmed.`);
        await refresh({ wallet: activeWallet, program: activeProgram });
        return signature;
      } catch (error) {
        const message = friendlyError(error);
        setStatus(message);
        log(`${label}: ${message}`);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [connectWallet, loadProgram, log, program, provider, refresh, wallet]
  );

  const createTokenAccount = useCallback(
    () =>
      sendTransaction("create token account", async (activeProgram, activeWallet) => {
        const accounts = pdaFor(activeProgram, activeWallet);
        const protocolAccount = await activeProgram.account.protocol.fetch(accounts.protocol);
        const mint = new PublicKey(protocolAccount.collateralMint);
        const ata = associatedTokenAddress(accounts.owner, mint);
        setOwnerTokenAccount(ata.toBase58());
        const existing = await activeProgram.provider.connection.getAccountInfo(ata);
        if (existing) return new Transaction();
        return new Transaction().add(createAssociatedTokenAccountInstruction(accounts.owner, accounts.owner, mint));
      }),
    [pdaFor, sendTransaction]
  );

  const createProfile = useCallback(
    () =>
      send("create profile", (activeProgram, activeWallet) => {
        const accounts = pdaFor(activeProgram, activeWallet);
        return activeProgram.methods.createTraderProfile().accountsStrict({
          protocol: accounts.protocol,
          traderProfile: accounts.traderProfile,
          marginAccount: accounts.marginAccount,
          owner: accounts.owner,
          systemProgram: SystemProgram.programId,
        });
      }),
    [pdaFor, send]
  );

  const deposit = useCallback(
    (amount) =>
      send("deposit", (activeProgram, activeWallet) => {
        const accounts = pdaFor(activeProgram, activeWallet);
        return activeProgram.methods.depositCollateral(new anchor.BN(positiveWhole(amount, "Deposit amount"))).accountsStrict({
          protocol: accounts.protocol,
          marginAccount: accounts.marginAccount,
          collateralVault: accounts.collateralVault,
          ownerTokenAccount: new PublicKey(ownerTokenAccount),
          owner: accounts.owner,
          tokenProgram: TOKEN_PROGRAM_ID,
        });
      }),
    [ownerTokenAccount, pdaFor, send]
  );

  const withdraw = useCallback(
    (amount) =>
      send("withdraw", (activeProgram, activeWallet) => {
        const accounts = pdaFor(activeProgram, activeWallet);
        return activeProgram.methods.withdrawCollateral(new anchor.BN(positiveWhole(amount, "Withdraw amount"))).accountsStrict({
          protocol: accounts.protocol,
          marginAccount: accounts.marginAccount,
          collateralVault: accounts.collateralVault,
          ownerTokenAccount: new PublicKey(ownerTokenAccount),
          owner: accounts.owner,
          tokenProgram: TOKEN_PROGRAM_ID,
        });
      }),
    [ownerTokenAccount, pdaFor, send]
  );

  const withPythRefresh = useCallback(async (activeProgram, tx, accounts) => {
    if (!DEFAULT_SOL_PYTH_PRICE_UPDATE) return tx;
    const refreshIx = await activeProgram.methods
      .updateMarketPriceFromPyth(new anchor.BN(0))
      .accountsStrict({
        protocol: accounts.protocol,
        market: accounts.market,
        priceUpdate: new PublicKey(DEFAULT_SOL_PYTH_PRICE_UPDATE),
      })
      .instruction()
      .catch(() => null);
    return refreshIx ? tx.preInstructions([refreshIx]) : tx;
  }, []);

  const openPosition = useCallback(
    ({ amount, leverage, isLong, marketIndex = 0 }) =>
      send("open position", async (activeProgram, activeWallet) => {
        const protocolAccount = protocol ?? (await activeProgram.account.protocol.fetch(pdaFor(activeProgram, activeWallet).protocol));
        const positionId = toNumber(protocolAccount.nextPositionId);
        const accounts = pdaFor(activeProgram, activeWallet, marketIndex, positionId);
        const tx = activeProgram.methods
          .openPosition(
            new anchor.BN(positionId),
            new anchor.BN(Number(marketIndex)),
            Boolean(isLong),
            new anchor.BN(positiveWhole(amount, "Collateral")),
            positiveWhole(leverage, "Leverage")
          )
          .accountsStrict({
            protocol: accounts.protocol,
            market: accounts.market,
            traderProfile: accounts.traderProfile,
            marginAccount: accounts.marginAccount,
            position: accounts.position,
            owner: accounts.owner,
            systemProgram: SystemProgram.programId,
          });
        return withPythRefresh(activeProgram, tx, accounts);
      }),
    [pdaFor, protocol, send, withPythRefresh]
  );

  const closePosition = useCallback(
    ({ positionId, marketIndex = 0 }) =>
      send("close position", async (activeProgram, activeWallet) => {
        const accounts = pdaFor(activeProgram, activeWallet, marketIndex, positionId);
        const tx = activeProgram.methods.closePosition(new anchor.BN(Number(positionId)), new anchor.BN(Number(marketIndex))).accountsStrict({
          protocol: accounts.protocol,
          market: accounts.market,
          traderProfile: accounts.traderProfile,
          marginAccount: accounts.marginAccount,
          position: accounts.position,
          owner: accounts.owner,
        });
        return withPythRefresh(activeProgram, tx, accounts);
      }),
    [pdaFor, send, withPythRefresh]
  );

  return {
    activity,
    busyAction,
    closePosition,
    connectAndLoad,
    connectWallet,
    createProfile,
    createTokenAccount,
    deposit,
    disconnectWallet,
    loadProgram,
    marginAccount,
    market,
    openPosition,
    ownerTokenAccount,
    positions,
    profile,
    program,
    protocol,
    refresh,
    status,
    tokenBalance,
    wallet,
    walletStatus,
    withdraw,
  };
}
