# Solana dApp

Учебный проект для практики с Solana devnet. Подключение Phantom кошелька, отправка SOL, минт токенов MYCOIN.

---

## Требования

- Node.js `v22+` (или минимум `v20.19+`)
- Браузер Chrome с расширением [Phantom](https://phantom.app)
- Phantom переключён на **devnet**: Settings → Developer Settings → Testnet Mode

---

## Установка

```bash
# 1. Создать проект
npm create vite@5 solana-dapp -- --template react-ts
cd solana-dapp

# 2. Установить зависимости
npm install
npm install @solana/web3.js @solana/spl-token
npm install --save-dev vite-plugin-node-polyfills

# 3. Заменить файлы
# Скопировать App.tsx → src/App.tsx
# Скопировать App.css → src/App.css
```

---

## Конфигурация

**vite.config.ts** — заменить содержимое на:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills(),
  ],
})
```

**src/App.tsx** — заменить две константы:

```typescript
const MYCOIN_MINT = new PublicKey("MINT_TOKEN_ADDRESS")
const MINT_AUTHORITY = new PublicKey("ВАШ_PUBKEY");
const RECIPIENT      = new PublicKey("АДРЕС_ПОЛУЧАТЕЛЯ");
```

Свой pubkey узнать:
```bash
solana address
```

---

## Запуск

```bash
npm run dev
```

Открыть в браузере: [http://localhost:5173](http://localhost:5173)

---

## Функции

| Кнопка | Что делает |
|--------|-----------|
| Connect Wallet | Подключает Phantom, показывает адрес и баланс |
| Send 0.01 SOL | Отправляет SOL на адрес `RECIPIENT`, выводит signature и ссылку на Explorer |
| Mint 100 MYCOIN | Минтит 100 токенов MYCOIN на подключённый кошелёк |
| Check Balance | Обновляет баланс SOL и MYCOIN |

> ⚠️ Кнопка **Mint** работает только с кошельком у которого есть `mint authority` (тот с которого создавался токен)

---

## Токен MYCOIN

```
Mint address: A9BNcuMXJPDfLKpmXAnhGwzrY6XKswbHwFwkBVHVJmSP
Decimals:     6
Network:      devnet
```

Explorer: https://explorer.solana.com/address/A9BNcuMXJPDfLKpmXAnhGwzrY6XKswbHwFwkBVHVJmSP?cluster=devnet