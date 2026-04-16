import { useState, useEffect } from "react";
import {
  Connection, PublicKey, SystemProgram, Transaction,
  LAMPORTS_PER_SOL, Keypair, TransactionInstruction, AccountMeta,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT,
  createSyncNativeInstruction, getAccount,
} from "@solana/spl-token";
import {
  Raydium, PoolUtils, TickUtils, getPdaTickArrayAddress, DEV_API_URLS,
} from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import "./App.css";

// ─── Константы ────────────────────────────────────────────────────────────────

const MY_TOKEN_MINT  = new PublicKey("4T9jq581kFSNE4aAtgzsAAVAy6Cfvq9M4dkBtahD4JSa");
const WSOL_MINT      = NATIVE_MINT;
const PROGRAM_ID     = new PublicKey("EbojNUfh9Jk6dyZaaQAJWofbdnkvdxfQbeAPq6iWoHAu");
const RAYDIUM_CLMM   = new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
const POOL_ID        = new PublicKey("7ZVMVG2fa1chZVqGDuiofgqq6R5puZJJNGgjFd4EkXpu");
const MEMO_PROGRAM   = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const DECIMALS       = 6;

const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// ─── PDAs (вычисляются один раз) ─────────────────────────────────────────────

const VAULT_STATE_PDA  = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), MY_TOKEN_MINT.toBuffer()], PROGRAM_ID
)[0];
const VAULT_TOKEN_PDA  = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_tokens"), MY_TOKEN_MINT.toBuffer()], PROGRAM_ID
)[0];
const SHARE_MINT_PDA   = PublicKey.findProgramAddressSync(
  [Buffer.from("share_mint"), MY_TOKEN_MINT.toBuffer()], PROGRAM_ID
)[0];

// ─── Типы ────────────────────────────────────────────────────────────────────

type Log = { icon: string; text: string; link?: string; type?: "success"|"error"|"info" };
interface PositionInfo {
  nftMint: string;
  tickLower: number;
  tickUpper: number;
  tickArrayLowerStart: number;
  tickArrayUpperStart: number;
  liquidity: string;
  poolState: string;
  tokenVault0: string;
  tokenVault1: string;
  vault0Mint: string;
  vault1Mint: string;
}

declare global { interface Window { solana?: any; } }

// ─── Утилиты для инструкций ──────────────────────────────────────────────────

async function discriminator(name: string): Promise<Buffer> {
  const data = new TextEncoder().encode(`global:${name}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(hash).slice(0, 8);
}

function u64LE(n: number | bigint): Buffer {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

function u128LE(n: bigint): Buffer {
  const buf = Buffer.allocUnsafe(16);
  buf.writeBigUInt64LE(n & BigInt("0xFFFFFFFFFFFFFFFF"));
  buf.writeBigUInt64LE(n >> BigInt(64), 8);
  return buf;
}

function i32LE(n: number): Buffer {
  const buf = Buffer.allocUnsafe(4);
  buf.writeInt32LE(n);
  return buf;
}

function rw(pubkey: PublicKey): AccountMeta { return { pubkey, isSigner: false, isWritable: true }; }
function ro(pubkey: PublicKey): AccountMeta { return { pubkey, isSigner: false, isWritable: false }; }
function sw(pubkey: PublicKey): AccountMeta { return { pubkey, isSigner: true, isWritable: true }; }

// ─── Основной компонент ───────────────────────────────────────────────────────

export default function App() {
  const [wallet, setWallet]           = useState<PublicKey | null>(null);
  const [solBal, setSolBal]           = useState("—");
  const [tokenBal, setTokenBal]       = useState("—");
  const [sharesBal, setSharesBal]     = useState("—");
  const [depositAmt, setDepositAmt]   = useState("10");
  const [position, setPosition]       = useState<PositionInfo | null>(() => {
    const saved = localStorage.getItem("vault_position");
    return saved ? JSON.parse(saved) : null;
  });
  const [logs, setLogs]               = useState<Log[]>([
    { icon:"ℹ️", text:"Connect your Phantom wallet to start", type:"info" }
  ]);
  const [loading, setLoading]         = useState<Record<string,boolean>>({});

  const addLog  = (e: Log) => setLogs(p => [...p, e]);
  const setLoad = (k: string, v: boolean) => setLoading(p => ({...p,[k]:v}));

  const fetchBalance = async (pk: PublicKey) => {
    setSolBal(((await connection.getBalance(pk)) / LAMPORTS_PER_SOL).toFixed(4));
    try {
      const ata = getAssociatedTokenAddressSync(MY_TOKEN_MINT, pk);
      const acc = await getAccount(connection, ata);
      setTokenBal((Number(acc.amount) / 10 ** DECIMALS).toFixed(2));
    } catch { setTokenBal("0"); }
    try {
      const shareAta = getAssociatedTokenAddressSync(SHARE_MINT_PDA, pk);
      const acc = await getAccount(connection, shareAta);
      setSharesBal((Number(acc.amount) / 10 ** DECIMALS).toFixed(2));
    } catch { setSharesBal("0"); }
  };

  // Автообновление балансов при подключении
  useEffect(() => {
    if (wallet) fetchBalance(wallet);
  }, [wallet]);

  // ─── Кошелёк ─────────────────────────────────────────────────────────────

  const connectWallet = async () => {
    try {
      if (!window.solana?.isPhantom) {
        addLog({ icon:"❌", text:"Phantom not found — install at phantom.app", type:"error" });
        return;
      }
      setLoad("connect", true);
      const { publicKey } = await window.solana.connect();
      setWallet(publicKey);
      addLog({ icon:"✅", text:`Connected: ${publicKey.toBase58()}`, type:"success" });
      await fetchBalance(publicKey);
    } catch(e:any) { addLog({ icon:"❌", text: e.message, type:"error" }); }
    finally { setLoad("connect", false); }
  };

  const sendAndConfirm = async (tx: Transaction, signers: Keypair[] = []): Promise<string> => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet!;
    if (signers.length) tx.partialSign(...signers);
    const signed = await window.solana.signTransaction(tx);
    let sig: string;
    try {
      sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    } catch (e: any) {
      if (e.message?.includes("already been processed")) {
        // Транзакция уже прошла — извлекаем подпись из signed tx
        sig = Buffer.from(signed.signatures[0].signature!).toString("hex");
        return sig;
      }
      throw e;
    }
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  };

  // ─── Депозит ─────────────────────────────────────────────────────────────

  const deposit = async () => {
    if (!wallet) return;
    try {
      setLoad("deposit", true);
      const amount = BigInt(Math.floor(parseFloat(depositAmt) * 10 ** DECIMALS));
      if (amount <= 0n) throw new Error("Введите сумму");

      addLog({ icon:"💰", text:`Депозит ${depositAmt} MyToken в vault...`, type:"info" });

      const userTokenAta = getAssociatedTokenAddressSync(MY_TOKEN_MINT, wallet);
      const userShareAta = getAssociatedTokenAddressSync(SHARE_MINT_PDA, wallet);

      const disc = await discriminator("deposit");
      const data = Buffer.concat([disc, u64LE(amount)]);

      const tx = new Transaction();

      // Создаём share ATA если нет
      if (!await connection.getAccountInfo(userShareAta)) {
        tx.add(createAssociatedTokenAccountInstruction(
          wallet, userShareAta, wallet, SHARE_MINT_PDA
        ));
      }

      tx.add(new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          rw(VAULT_STATE_PDA),
          rw(VAULT_TOKEN_PDA),
          rw(SHARE_MINT_PDA),
          rw(userTokenAta),
          rw(userShareAta),
          sw(wallet),
          ro(TOKEN_PROGRAM_ID),
        ],
        data,
      }));

      const sig = await sendAndConfirm(tx);
      addLog({ icon:"✅", text:`Депозит выполнен!`, type:"success" });
      addLog({ icon:"🔗", text:"Explorer", link:`https://explorer.solana.com/tx/${sig}?cluster=devnet` });
      await fetchBalance(wallet);
    } catch(e:any) {
      addLog({ icon:"❌", text: e.message, type:"error" });
      if (e.logs) e.logs.forEach((l:string) => console.error(l));
    }
    finally { setLoad("deposit", false); }
  };

  // ─── Открыть позицию ─────────────────────────────────────────────────────

  const openPosition = async () => {
    if (!wallet) return;
    try {
      setLoad("open", true);
      addLog({ icon:"📈", text:"Загрузка данных пула...", type:"info" });

      // Raydium SDK
      const raydium = await Raydium.load({
        connection,
        cluster: "devnet",
        disableFeatureCheck: true,
        disableLoadToken: true,
        blockhashCommitment: "finalized",
        urlConfigs: DEV_API_URLS,
      });

      const { poolInfo, poolKeys } = await raydium.clmm.getPoolInfoFromRpc(POOL_ID.toBase58());
      const tickSpacing = poolInfo.config.tickSpacing;
      const currentTick: number = (poolInfo as any).tickCurrent ?? 0;

      const TICK_RANGE = 5000;
      const tickLower = Math.floor((currentTick - TICK_RANGE) / tickSpacing) * tickSpacing;
      const tickUpper = Math.ceil((currentTick + TICK_RANGE) / tickSpacing) * tickSpacing;
      const tickArrayLowerStart = TickUtils.getTickArrayStartIndexByTick(tickLower, tickSpacing);
      const tickArrayUpperStart = TickUtils.getTickArrayStartIndexByTick(tickUpper, tickSpacing);

      addLog({ icon:"📊", text:`Tick range: ${tickLower} → ${tickUpper}`, type:"info" });

      const myTokenIsA = poolInfo.mintA.address === MY_TOKEN_MINT.toBase58();
      const epochInfo = await connection.getEpochInfo();
      const { liquidity, amountSlippageA, amountSlippageB } =
        await PoolUtils.getLiquidityAmountOutFromAmountIn({
          poolInfo,
          slippage: 0.01,
          inputA: myTokenIsA,
          tickUpper: Math.max(tickLower, tickUpper),
          tickLower: Math.min(tickLower, tickUpper),
          amount: new BN(10 * 10 ** DECIMALS),
          add: true,
          epochInfo,
          amountHasFee: false,
        });

      const amount0Max = amountSlippageA.amount.toNumber();
      const amount1Max = amountSlippageB.amount.toNumber();
      const solAmt  = myTokenIsA ? amount1Max : amount0Max;
      const tokenAmt = myTokenIsA ? amount0Max : amount1Max;
      addLog({ icon:"💧", text:`Ликвидность: ${liquidity.toString()}, SOL: ${(solAmt/1e9).toFixed(4)}, MyToken: ${(tokenAmt/1e6).toFixed(2)}`, type:"info" });

      // Подготовить vault wSOL account
      const vaultWsolAta = await getAssociatedTokenAddress(WSOL_MINT, VAULT_STATE_PDA, true);
      const wrapTx = new Transaction();
      if (!await connection.getAccountInfo(vaultWsolAta)) {
        wrapTx.add(createAssociatedTokenAccountInstruction(
          wallet, vaultWsolAta, VAULT_STATE_PDA, WSOL_MINT
        ));
      }
      const wsolNeeded = solAmt + 20_000_000;
      wrapTx.add(
        SystemProgram.transfer({ fromPubkey: wallet, toPubkey: vaultWsolAta, lamports: wsolNeeded }),
        createSyncNativeInstruction(vaultWsolAta)
      );
      const wrapSig = await sendAndConfirm(wrapTx);
      addLog({ icon:"💧", text:`wSOL wrapped`, type:"info" });
      console.log("wrap tx:", wrapSig);

      // Убедиться что в vault достаточно MyToken
      const myTokenNeed = tokenAmt + 5 * 10 ** DECIMALS;
      const vaultTokenBal = await connection.getTokenAccountBalance(VAULT_TOKEN_PDA).catch(() => null);
      const vaultTokenAmt = vaultTokenBal ? Number(vaultTokenBal.value.amount) : 0;
      if (vaultTokenAmt < myTokenNeed) {
        const toTransfer = myTokenNeed - vaultTokenAmt;
        const userTokenAta = getAssociatedTokenAddressSync(MY_TOKEN_MINT, wallet);
        const transferTx = new Transaction();
        const { createTransferInstruction } = await import("@solana/spl-token");
        transferTx.add(createTransferInstruction(userTokenAta, VAULT_TOKEN_PDA, wallet, toTransfer));
        await sendAndConfirm(transferTx);
        addLog({ icon:"📤", text:`MyToken → vault`, type:"info" });
      }

      // Деривировать Raydium аккаунты
      const poolStatePK   = new PublicKey(poolKeys.id);
      const tokenVault0   = new PublicKey(poolKeys.vault.A);
      const tokenVault1   = new PublicKey(poolKeys.vault.B);
      const vault0Mint    = new PublicKey(poolInfo.mintA.address);
      const vault1Mint    = new PublicKey(poolInfo.mintB.address);
      const tickArrayLower = getPdaTickArrayAddress(RAYDIUM_CLMM, poolStatePK, tickArrayLowerStart).publicKey;
      const tickArrayUpper = getPdaTickArrayAddress(RAYDIUM_CLMM, poolStatePK, tickArrayUpperStart).publicKey;
      const [tickArrayBitmap] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_tick_array_bitmap_extension"), poolStatePK.toBuffer()], RAYDIUM_CLMM
      );

      const positionNftMintKp = Keypair.generate();
      const positionNftAccount = getAssociatedTokenAddressSync(
        positionNftMintKp.publicKey, VAULT_STATE_PDA, true, TOKEN_2022_PROGRAM_ID
      );
      const [personalPosition] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), positionNftMintKp.publicKey.toBuffer()], RAYDIUM_CLMM
      );

      // Сериализация аргументов
      const disc = await discriminator("open_raydium_position");
      const args = Buffer.concat([
        disc,
        i32LE(tickLower),
        i32LE(tickUpper),
        i32LE(tickArrayLowerStart),
        i32LE(tickArrayUpperStart),
        u128LE(BigInt(liquidity.toString())),
        u64LE(amount0Max),
        u64LE(amount1Max),
      ]);

      // vault_token_account и vault_wsol_account передаются в struct в фиксированном порядке,
      // контракт сам определяет token0/token1 по минту пула.
      const openTx = new Transaction().add(new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          sw(wallet),                         // admin
          rw(VAULT_STATE_PDA),                // vault_state
          rw(VAULT_TOKEN_PDA),                // vault_token_account
          rw(vaultWsolAta),                   // vault_wsol_account
          ro(WSOL_MINT),                      // wsol_mint
          rw(poolStatePK),                    // pool_state
          { pubkey: positionNftMintKp.publicKey, isSigner: true, isWritable: true }, // position_nft_mint
          rw(positionNftAccount),             // position_nft_account
          rw(personalPosition),               // personal_position
          rw(tickArrayLower),                 // tick_array_lower
          rw(tickArrayUpper),                 // tick_array_upper
          rw(tokenVault0),                    // token_vault_0
          rw(tokenVault1),                    // token_vault_1
          ro(vault0Mint),                     // vault_0_mint
          ro(vault1Mint),                     // vault_1_mint
          ro(tickArrayBitmap),               // tick_array_bitmap
          ro(RAYDIUM_CLMM),                   // clmm_program
          ro(new PublicKey("SysvarRent111111111111111111111111111111111")), // rent
          ro(SystemProgram.programId),        // system_program
          ro(TOKEN_PROGRAM_ID),               // token_program
          ro(TOKEN_2022_PROGRAM_ID),          // token_program_2022
          ro(ASSOCIATED_TOKEN_PROGRAM_ID),    // associated_token_program
        ],
        data: args,
      }));

      const sig = await sendAndConfirm(openTx, [positionNftMintKp]);
      addLog({ icon:"✅", text:`Позиция открыта!`, type:"success" });
      addLog({ icon:"🔗", text:"Explorer", link:`https://explorer.solana.com/tx/${sig}?cluster=devnet` });

      // Сохранить информацию о позиции
      const pos: PositionInfo = {
        nftMint: positionNftMintKp.publicKey.toBase58(),
        tickLower,
        tickUpper,
        tickArrayLowerStart,
        tickArrayUpperStart,
        liquidity: liquidity.toString(),
        poolState: poolStatePK.toBase58(),
        tokenVault0: tokenVault0.toBase58(),
        tokenVault1: tokenVault1.toBase58(),
        vault0Mint: vault0Mint.toBase58(),
        vault1Mint: vault1Mint.toBase58(),
      };
      setPosition(pos);
      localStorage.setItem("vault_position", JSON.stringify(pos));
      await fetchBalance(wallet);
    } catch(e:any) {
      addLog({ icon:"❌", text: e.message, type:"error" });
      if (e.logs) e.logs.forEach((l:string) => console.error(l));
    }
    finally { setLoad("open", false); }
  };

  // ─── Закрыть позицию ─────────────────────────────────────────────────────

  const closePosition = async () => {
    if (!wallet || !position) return;
    try {
      setLoad("close", true);
      addLog({ icon:"📉", text:"Закрываем позицию...", type:"info" });

      const nftMintPK      = new PublicKey(position.nftMint);
      const poolStatePK    = new PublicKey(position.poolState);
      const tokenVault0    = new PublicKey(position.tokenVault0);
      const tokenVault1    = new PublicKey(position.tokenVault1);
      const vault0MintPK   = new PublicKey(position.vault0Mint);
      const vault1MintPK   = new PublicKey(position.vault1Mint);

      const positionNftAccount = getAssociatedTokenAddressSync(
        nftMintPK, VAULT_STATE_PDA, true, TOKEN_2022_PROGRAM_ID
      );
      const [personalPosition] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), nftMintPK.toBuffer()], RAYDIUM_CLMM
      );
      const vaultWsolAta = getAssociatedTokenAddressSync(WSOL_MINT, VAULT_STATE_PDA, true);

      const tickArrayLower = getPdaTickArrayAddress(
        RAYDIUM_CLMM, poolStatePK, position.tickArrayLowerStart
      ).publicKey;
      const tickArrayUpper = getPdaTickArrayAddress(
        RAYDIUM_CLMM, poolStatePK, position.tickArrayUpperStart
      ).publicKey;

      const disc = await discriminator("close_raydium_position");
      const data = Buffer.concat([disc, u64LE(0), u64LE(0)]); // amount_0_min=0, amount_1_min=0

      const closeTx = new Transaction().add(new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          sw(wallet),                // admin
          rw(VAULT_STATE_PDA),       // vault_state
          rw(VAULT_TOKEN_PDA),       // vault_token_account
          rw(vaultWsolAta),          // vault_wsol_account
          ro(WSOL_MINT),             // wsol_mint
          rw(poolStatePK),           // pool_state
          rw(nftMintPK),             // position_nft_mint
          rw(positionNftAccount),    // position_nft_account
          rw(personalPosition),      // personal_position
          rw(tokenVault0),           // token_vault_0
          rw(tokenVault1),           // token_vault_1
          rw(tickArrayLower),        // tick_array_lower
          rw(tickArrayUpper),        // tick_array_upper
          ro(vault0MintPK),          // vault_0_mint
          ro(vault1MintPK),          // vault_1_mint
          ro(RAYDIUM_CLMM),          // clmm_program
          ro(TOKEN_PROGRAM_ID),      // token_program
          ro(TOKEN_2022_PROGRAM_ID), // token_program_2022
          ro(MEMO_PROGRAM),          // memo_program
          ro(SystemProgram.programId), // system_program
        ],
        data,
      }));

      const sig = await sendAndConfirm(closeTx);
      addLog({ icon:"✅", text:`Позиция закрыта!`, type:"success" });
      addLog({ icon:"🔗", text:"Explorer", link:`https://explorer.solana.com/tx/${sig}?cluster=devnet` });
      setPosition(null);
      localStorage.removeItem("vault_position");
      await fetchBalance(wallet);
    } catch(e:any) {
      addLog({ icon:"❌", text: e.message, type:"error" });
      if (e.logs) e.logs.forEach((l:string) => console.error(l));
    }
    finally { setLoad("close", false); }
  };

  const handleCheck = async () => {
    if (!wallet) return;
    setLoad("check", true);
    await fetchBalance(wallet);
    addLog({ icon:"📊", text:`SOL: ${solBal} | MyToken: ${tokenBal} | Shares: ${sharesBal}`, type:"info" });
    setLoad("check", false);
  };

  const short = (s: string) => `${s.slice(0,6)}...${s.slice(-4)}`;

  return (
    <div className="app">
      <div className="card">
        {/* ── Header ── */}
        <div className="header">
          <h1>Vault dApp</h1>
          <span className="badge">devnet</span>
        </div>

        {/* ── Wallet panel ── */}
        <div className="wallet-panel">
          {wallet ? (
            <>
              <div className="wallet-row">
                <span className="dot on"/>
                <span className="addr">{short(wallet.toBase58())}</span>
              </div>
              <div className="balances">
                <div className="bal"><span className="lbl">SOL</span><span className="val green">{solBal}</span></div>
                <div className="bal"><span className="lbl">MyToken</span><span className="val purple">{tokenBal}</span></div>
                <div className="bal"><span className="lbl">Shares</span><span className="val blue">{sharesBal}</span></div>
              </div>
            </>
          ) : (
            <div className="wallet-row"><span className="dot"/><span className="addr muted">Not connected</span></div>
          )}
        </div>

        {/* ── Общие кнопки ── */}
        <div className="btns">
          <button className="btn b-connect" onClick={connectWallet} disabled={loading.connect||!!wallet}>
            {loading.connect?<i/>:"🔗"} {wallet ? "Connected" : "Connect Wallet"}
          </button>
          <button className="btn b-check" onClick={handleCheck} disabled={!wallet||loading.check}>
            {loading.check?<i/>:"📊"} Обновить балансы
          </button>
        </div>

        {/* ── Vault секция ── */}
        <div className="section-label">── Vault ──────────────────────────</div>

        <div className="deposit-row">
          <input
            className="amount-input"
            type="number"
            min="0"
            step="1"
            value={depositAmt}
            onChange={e => setDepositAmt(e.target.value)}
            placeholder="Сумма MyToken"
            disabled={!wallet}
          />
          <span className="token-label">MyToken</span>
        </div>

        <div className="btns">
          <button className="btn b-deposit" onClick={deposit} disabled={!wallet||loading.deposit}>
            {loading.deposit?<i/>:"💰"} Deposit
          </button>
          <button className="btn b-open" onClick={openPosition} disabled={!wallet||loading.open||!!position}>
            {loading.open?<i/>:"📈"} Open Position
          </button>
        </div>

        {/* ── Информация о позиции ── */}
        {position && (
          <div className="position-card">
            <div className="pos-header">
              <span className="pos-dot"/>
              <span className="pos-title">Active Position</span>
            </div>
            <div className="pos-row">
              <span className="pos-lbl">NFT Mint</span>
              <a
                className="pos-val link"
                href={`https://explorer.solana.com/address/${position.nftMint}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
              >
                {short(position.nftMint)} ↗
              </a>
            </div>
            <div className="pos-row">
              <span className="pos-lbl">Ticks</span>
              <span className="pos-val">{position.tickLower} → {position.tickUpper}</span>
            </div>
            <div className="pos-row">
              <span className="pos-lbl">Liquidity</span>
              <span className="pos-val">{BigInt(position.liquidity).toLocaleString()}</span>
            </div>
            <button
              className="btn b-close"
              onClick={closePosition}
              disabled={!wallet||loading.close}
              style={{marginTop:"10px"}}
            >
              {loading.close?<i/>:"📉"} Close Position
            </button>
          </div>
        )}

        {/* ── Activity log ── */}
        <div className="log">
          {logs.map((l,i) => (
            <div key={i} className={`le ${l.type||""}`}>
              <span>{l.icon}</span>
              <span>{l.link
                ? <a href={l.link} target="_blank" rel="noreferrer">{l.text} ↗</a>
                : l.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
