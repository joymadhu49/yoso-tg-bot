# 🎯 Yoso Telegram Bot — Trade yoso.fun from Telegram

A Telegram bot for trading on [yoso.fun](https://yoso.fun) prediction markets (Base chain). All button-driven — no commands to memorize. Zero gas fees.

## ✨ Features

- **100% Button UI** — tap to browse, buy, sell. No commands needed
- **Buy & Flip Mode** — auto buy → hold briefly → sell same shares → next market
- **Mixed Mode** — random buys and sells across different markets
- **Auto-Trade** — fully customizable: rounds, delays, amounts, YES/NO ratio
- **Sell All** — dump all positions in one tap
- **Multi-User** — each user sets up their own wallet
- **Admin Panel** — approve/deny users, manage access
- **Zero Gas** — all trades are paymaster-sponsored

## 🖼️ How It Looks

```
🎯 Yoso Bot

💰 Balance: 0.89 USDC
📍 0x41Eb...5D5F

[📊 Markets] [💰 Buy]
[💸 Sell]    [📤 Sell All]
[🤖 Auto]   [⚙️ Settings]
[🏦 Balance]
```

Auto-Trade with progress bar:
```
🤖 Auto-Trade [3/10]
██████░░░░

📈 1. BUY YES "Elon trillionaire" — $0.08 → 0.092 shares
📉 1. SELL YES "Elon trillionaire" → +0.07 USDC
📈 2. BUY NO "SpaceX IPO" — $0.06 → 0.089 shares

📈 3 buys · 📉 1 sells

⏳ Holding 0.089 NO... selling in 15s

[⏹ Stop]
```

## 🚀 Run on Your PC

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A yoso.fun account with USDC on Base

### Step 1: Create a Telegram Bot

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`
3. Pick a name and username
4. Copy the bot token

### Step 2: Get Your Telegram ID

1. Open Telegram, search for **@userinfobot**
2. Send `/start`
3. Copy your ID number

### Step 3: Clone & Install

```bash
git clone https://github.com/joymadhu49/yoso-tg-bot.git
cd yoso-tg-bot
npm install
```

### Step 4: Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=8609766057:AAGcWeBcXA8BdePDUYjTaUgZvIuGtnu4rRA
BOT_ENCRYPTION_KEY=any_random_string_at_least_32_characters
ADMIN_ID=7332734457
```

| Setting | What it is |
|---------|-----------|
| `BOT_TOKEN` | From BotFather (step 1) |
| `BOT_ENCRYPTION_KEY` | Any random string, 32+ chars. Used to encrypt user private keys in the database |
| `ADMIN_ID` | Your Telegram ID (step 2). You'll be able to approve/deny other users |

### Step 5: Run

```bash
# Build & start
npx tsc && node dist/index.js

# Or for development (auto-rebuild)
npx tsx src/index.ts
```

### Step 6: Set Up Your Wallet in the Bot

1. Open your bot in Telegram
2. Send `/start`
3. Tap **🔐 Setup Wallet**
4. Paste your MetaMask private key (message is auto-deleted for security)
5. Paste your smart account address (from yoso.fun profile)
6. Done! Start trading

## 🤖 Trading Modes

### 🔄 Buy & Flip (default)
Each round:
1. Pick random market + random YES/NO
2. Buy shares ($0.05–$0.10)
3. Hold for 10–30 seconds
4. Sell same shares back
5. Wait, then next market

Best for: generating trade volume / airdrop farming

### 📊 Mixed
Each round randomly picks:
- **60% chance** → Buy on a new random market
- **40% chance** → Sell an existing position

Best for: building diverse positions across markets

Switch modes anytime from the Auto-Trade screen.

## ⚙️ Customizable Settings

All configurable from Telegram (Auto-Trade → Settings):

| Setting | Default | Description |
|---------|---------|-------------|
| Rounds | 10 | Trades per session |
| Min delay | 30s | Minimum wait between trades |
| Max delay | 180s | Maximum wait between trades |
| Min amount | $0.05 | Minimum USDC per trade |
| Max amount | $0.10 | Maximum USDC per trade |
| YES chance | 55% | Probability of picking YES |
| Sell chance | 40% | (Mixed mode) Probability of selling |
| Max positions | 5 | (Mixed mode) Max open positions |
| Mode | Flip | Buy & Flip or Mixed |

## 📁 Project Structure

```
yoso-tg-bot/
├── src/
│   ├── index.ts          # Entry + callback routing
│   ├── bot.ts            # Grammy bot setup + session
│   ├── db.ts             # SQLite database (users, settings)
│   ├── crypto.ts         # AES encryption for private keys
│   ├── helpers.ts        # Shared utils (Markdown escape, safe edit, etc.)
│   ├── menus/
│   │   ├── main.ts       # Main menu + welcome
│   │   ├── markets.ts    # Market browser (paginated)
│   │   ├── buy.ts        # Buy flow (market → side → amount → confirm)
│   │   ├── sell.ts       # Sell flow (position → amount → confirm)
│   │   ├── balance.ts    # Balance + positions view
│   │   ├── auto.ts       # Auto-trade (flip/mixed modes)
│   │   └── settings.ts   # Settings editor
│   └── engine/           # Trading engine (DO NOT MODIFY)
│       ├── config.ts     # Constants (contracts, RPC)
│       ├── contracts.ts  # ABI selectors
│       ├── api.ts        # yoso.fun REST API
│       ├── client.ts     # ERC-4337 UserOperation pipeline
│       ├── trading.ts    # Buy/sell logic + quotes
│       └── auto-trade.ts # Auto-trade engine (flip + mixed)
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## 🔒 Security

- Private keys are encrypted with **AES-256-GCM** before storing in SQLite
- Bot auto-deletes messages containing private keys
- Only works in DMs (not groups)
- Admin must approve new users before they can trade
- Rate limit: 1 trade per 10 seconds per user

## ☁️ Deploy to Server (Optional)

### Using Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch (from project directory)
fly launch --name yoso-tg-bot --region sin

# Set secrets
fly secrets set BOT_TOKEN="your_token" BOT_ENCRYPTION_KEY="your_key" ADMIN_ID="your_id"

# Deploy
fly deploy
```

### Using PM2 (on any VPS)

```bash
# Install PM2
npm install -g pm2

# Build
npx tsc

# Start with PM2
pm2 start dist/index.js --name yoso-tg-bot

# Auto-restart on crash
pm2 save
pm2 startup
```

## 🔧 Technical Details

### Contracts (Base Chain)

| Contract | Address |
|----------|---------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| Paymaster | `0x2cc0c7981D846b9F2a16276556f6e8cb52BfB633` |

### How Trading Works

All trades use **ERC-4337 Account Abstraction**:
- Your MetaMask EOA signs UserOperations
- A Smart Account (contract wallet) executes trades
- Alchemy's paymaster sponsors gas — $0 cost

## ⚠️ Disclaimer

Educational purposes only. Prediction markets involve risk. Only trade what you can afford to lose.

## 📝 License

MIT
