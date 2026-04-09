import { useState } from "react";
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction, createMintToInstruction } from "@solana/spl-token";
import "./App.css";

const MYCOIN_MINT    = new PublicKey("A9BNcuMXJPDfLKpmXAnhGwzrY6XKswbHwFwkBVHVJmSP");
const MINT_AUTHORITY = new PublicKey("5W7MHVZ5eVkhjyWVuMLCVo1Ya9SKxQJ2yayp7ivPVaZZ");
const RECIPIENT      = new PublicKey("38afxYQhjGKgyoWEsKhAZ85xkdCj3z6bj3YU5RY74mR1");
const DECIMALS       = 6;
const connection     = new Connection("https://api.devnet.solana.com", "confirmed");

type Log = { icon: string; text: string; link?: string; type?: "success"|"error"|"info" };
declare global { interface Window { solana?: any; } }

export default function App() {
  const [wallet, setWallet]           = useState<PublicKey | null>(null);
  const [solBal, setSolBal]           = useState("—");
  const [coinBal, setCoinBal]         = useState("—");
  const [logs, setLogs]               = useState<Log[]>([{ icon:"ℹ️", text:"Connect your Phantom wallet to start", type:"info" }]);
  const [loading, setLoading]         = useState<Record<string,boolean>>({});

  const addLog  = (e: Log) => setLogs(p => [...p, e]);
  const setLoad = (k: string, v: boolean) => setLoading(p => ({...p,[k]:v}));

  const fetchBalance = async (pk: PublicKey) => {
    setSolBal(((await connection.getBalance(pk)) / LAMPORTS_PER_SOL).toFixed(4));
    try {
      const ata = await getAssociatedTokenAddress(MYCOIN_MINT, pk);
      const acc = await getAccount(connection, ata);
      setCoinBal(String(Number(acc.amount) / 10**DECIMALS));
    } catch { setCoinBal("0"); }
  };

  const connectWallet = async () => {
    try {
      if (!window.solana?.isPhantom) { addLog({icon:"❌",text:"Phantom not found — install at phantom.app",type:"error"}); return; }
      setLoad("connect",true);
      const { publicKey } = await window.solana.connect();
      setWallet(publicKey);
      addLog({icon:"✅",text:`Connected: ${publicKey.toBase58()}`,type:"success"});
      await fetchBalance(publicKey);
    } catch(e:any) { addLog({icon:"❌",text:e.message,type:"error"}); }
    finally { setLoad("connect",false); }
  };

  const sendSOL = async () => {
    if (!wallet) return;
    try {
      setLoad("send",true);
      addLog({icon:"🚀",text:"Sending 0.01 SOL..."});
      const tx = new Transaction().add(SystemProgram.transfer({fromPubkey:wallet,toPubkey:RECIPIENT,lamports:0.01*LAMPORTS_PER_SOL}));
      const {blockhash} = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash; tx.feePayer = wallet;
      const signed = await window.solana.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig);
      addLog({icon:"✅",text:"Sent!",type:"success"});
      addLog({icon:"🔗",text:"View on Explorer",link:`https://explorer.solana.com/tx/${sig}?cluster=devnet`});
      await fetchBalance(wallet);
    } catch(e:any) { addLog({icon:"❌",text:e.message,type:"error"}); }
    finally { setLoad("send",false); }
  };

  const mintMYCOIN = async () => {
    if (!wallet) return;
    try {
      setLoad("mint",true);
      addLog({icon:"🪙",text:"Minting 100 MYCOIN..."});
      const ata = await getAssociatedTokenAddress(MYCOIN_MINT, wallet);
      const tx = new Transaction();
      if (!await connection.getAccountInfo(ata)) tx.add(createAssociatedTokenAccountInstruction(wallet,ata,wallet,MYCOIN_MINT));
      tx.add(createMintToInstruction(MYCOIN_MINT,ata,MINT_AUTHORITY,100*10**DECIMALS));
      const {blockhash} = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash; tx.feePayer = wallet;
      const signed = await window.solana.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig);
      addLog({icon:"✅",text:"Minted 100 MYCOIN!",type:"success"});
      addLog({icon:"🔗",text:"View on Explorer",link:`https://explorer.solana.com/tx/${sig}?cluster=devnet`});
      await fetchBalance(wallet);
    } catch(e:any) { addLog({icon:"❌",text:e.message,type:"error"}); }
    finally { setLoad("mint",false); }
  };

  const handleCheck = async () => {
    if (!wallet) return;
    setLoad("check",true);
    await fetchBalance(wallet);
    addLog({icon:"📊",text:`SOL: ${solBal} | MYCOIN: ${coinBal}`,type:"info"});
    setLoad("check",false);
  };

  const short = (pk: PublicKey) => `${pk.toBase58().slice(0,8)}...${pk.toBase58().slice(-6)}`;

  return (
    <div className="app">
      <div className="card">
        <div className="header">
          <h1>Solana dApp</h1>
          <span className="badge">devnet</span>
        </div>

        <div className="wallet-panel">
          {wallet ? (
            <>
              <div className="wallet-row">
                <span className="dot on"/>
                <span className="addr">{short(wallet)}</span>
              </div>
              <div className="balances">
                <div className="bal"><span className="lbl">SOL</span><span className="val green">{solBal}</span></div>
                <div className="bal"><span className="lbl">MYCOIN</span><span className="val purple">{coinBal}</span></div>
              </div>
            </>
          ) : (
            <div className="wallet-row"><span className="dot"/><span className="addr muted">Not connected</span></div>
          )}
        </div>

        <div className="btns">
          <button className="btn b-connect" onClick={connectWallet} disabled={loading.connect||!!wallet}>
            {loading.connect?<i/>:"🔗"} {wallet?"Connected":"Connect Wallet"}
          </button>
          <button className="btn b-send" onClick={sendSOL} disabled={!wallet||loading.send}>
            {loading.send?<i/>:"💸"} Send 0.01 SOL
          </button>
          <button className="btn b-mint" onClick={mintMYCOIN} disabled={!wallet||loading.mint}>
            {loading.mint?<i/>:"🪙"} Mint 100 MYCOIN
          </button>
          <button className="btn b-check" onClick={handleCheck} disabled={!wallet||loading.check}>
            {loading.check?<i/>:"📊"} Check Balance
          </button>
        </div>

        <div className="log">
          {logs.map((l,i) => (
            <div key={i} className={`le ${l.type||""}`}>
              <span>{l.icon}</span>
              <span>{l.link?<a href={l.link} target="_blank" rel="noreferrer">{l.text} ↗</a>:l.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}