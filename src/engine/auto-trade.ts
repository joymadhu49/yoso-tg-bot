import { getAddress, parseUnits, type Address } from 'viem';
import { listMarkets } from './api.js';
import { quoteBuy, quoteSell, buy, sell, getUsdcBalance, getSharesBalance, fmtUsdc } from './trading.js';
import { USDC_DECIMALS } from './config.js';

export type TradingMode = 'mixed' | 'flip';

export type AutoTradeSettings = {
  rounds: number;
  minDelaySec: number;
  maxDelaySec: number;
  minUsdc: number;
  maxUsdc: number;
  yesChance: number;   // 0-100
  sellChance: number;  // 0-100
  maxPositions: number;
  mode: TradingMode;   // 'mixed' = random buy/sell, 'flip' = buy then sell same
};

export type AutoTradeProgress = {
  round: number;
  totalRounds: number;
  action: 'buy' | 'sell' | 'info' | 'error' | 'done' | 'waiting';
  message: string;
};

type Position = {
  market: string;
  marketTitle: string;
  side: 'YES' | 'NO';
  shares: bigint;
  yesToken: string;
  noToken: string;
};

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function getActiveMarkets(): Promise<any[]> {
  const data = await listMarkets({ limit: 24, sort: 'trending' });
  const items: any[] = data?.data ?? data?.markets ?? data ?? [];
  return items.filter((m: any) => {
    const vol = Number(m.totalVolume ?? 0);
    return m.state === 'TRADING' && vol > 10_000_000;
  });
}

async function findOpenPositions(markets: any[], smartAccount: Address): Promise<Position[]> {
  const positions: Position[] = [];
  for (const m of markets) {
    const addr = m.address ?? m.id;
    const yesToken = m.yesToken;
    const noToken = m.noToken;
    if (!yesToken || !noToken) continue;
    try {
      const yesBal = await getSharesBalance(getAddress(yesToken), smartAccount);
      const noBal = await getSharesBalance(getAddress(noToken), smartAccount);
      if (yesBal > 0n) {
        positions.push({ market: addr, marketTitle: (m.title ?? 'Unknown').slice(0, 50), side: 'YES', shares: yesBal, yesToken, noToken });
      }
      if (noBal > 0n) {
        positions.push({ market: addr, marketTitle: (m.title ?? 'Unknown').slice(0, 50), side: 'NO', shares: noBal, yesToken, noToken });
      }
    } catch {
      // Skip markets with issues
    }
  }
  return positions;
}

export async function autoTrade(
  privateKey: string,
  smartAccountAddress: Address,
  settings: AutoTradeSettings,
  onProgress: (p: AutoTradeProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const yesChance = settings.yesChance / 100;
  const sellChance = settings.sellChance / 100;
  const mode = settings.mode ?? 'mixed';

  const usdcBal = await getUsdcBalance(smartAccountAddress);
  onProgress({ round: 0, totalRounds: settings.rounds, action: 'info', message: `USDC: ${fmtUsdc(usdcBal)} | Mode: ${mode}` });

  if (usdcBal < parseUnits(String(settings.minUsdc), USDC_DECIMALS)) {
    onProgress({ round: 0, totalRounds: settings.rounds, action: 'error', message: 'Not enough USDC to trade!' });
    return;
  }

  let buyCount = 0;
  let sellCount = 0;

  async function sleepWithAbort(ms: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (signal.aborted) break;
      await sleep(Math.min(2000, ms - (Date.now() - start)));
    }
  }

  if (mode === 'flip') {
    // ─── FLIP MODE: buy → wait → sell same → next market ───
    for (let i = 0; i < settings.rounds; i++) {
      if (signal.aborted) break;

      const markets = await getActiveMarkets();
      if (!markets.length) {
        onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'error', message: 'No markets found' });
        await sleep(15_000);
        continue;
      }

      // Pick random market
      const market = markets[randInt(0, markets.length - 1)];
      const marketAddr = getAddress(market.address ?? market.id);
      const title = (market.title ?? 'Unknown').slice(0, 30);
      const side = Math.random() < yesChance ? 'YES' : 'NO';
      const outcome = side === 'YES' ? 1n : 2n;
      const rawAmt = rand(settings.minUsdc, settings.maxUsdc);
      const amount = Math.round(rawAmt * 1000) / 1000;
      const usdcAmount = parseUnits(String(amount), USDC_DECIMALS);

      // Step 1: BUY
      let boughtShares = 0n;
      try {
        const res = await buy({ privateKey, smartAccountAddress, market: marketAddr, outcome, usdcAmount, slippageBps: 300 });
        buyCount++;
        boughtShares = res.quote.shares;
        onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'buy', message: `BUY ${side} "${title}" — $${amount} → ${fmtUsdc(boughtShares)} shares` });
      } catch {
        onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'error', message: `BUY failed on "${title}"` });
        // Delay then continue to next market
        if (i < settings.rounds - 1) {
          const d = randInt(settings.minDelaySec * 1000, settings.maxDelaySec * 1000);
          onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'waiting', message: `Next in ${(d / 1000).toFixed(0)}s...` });
          await sleepWithAbort(d);
        }
        continue;
      }

      if (signal.aborted) break;

      // Step 2: Wait briefly before selling (10-30s — quick flip)
      const flipDelay = randInt(10_000, 30_000);
      onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'waiting', message: `Holding ${fmtUsdc(boughtShares)} ${side}... selling in ${(flipDelay / 1000).toFixed(0)}s` });
      await sleepWithAbort(flipDelay);

      if (signal.aborted) break;

      // Step 3: SELL the same shares back
      try {
        const res = await sell({ privateKey, smartAccountAddress, market: marketAddr, outcome, shares: boughtShares, slippageBps: 300 });
        sellCount++;
        const ret = fmtUsdc(res.quote.usdcReturn);
        onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'sell', message: `SELL ${side} "${title}" → +${ret} USDC` });
      } catch {
        onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'error', message: `SELL failed on "${title}" (shares still held)` });
      }

      // Delay before next flip
      if (i < settings.rounds - 1 && !signal.aborted) {
        const d = randInt(settings.minDelaySec * 1000, settings.maxDelaySec * 1000);
        onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'waiting', message: `Next flip in ${(d / 1000).toFixed(0)}s...` });
        await sleepWithAbort(d);
      }
    }
  } else {
    // ─── MIXED MODE: random buy or sell each round ───
    for (let i = 0; i < settings.rounds; i++) {
      if (signal.aborted) break;

      const markets = await getActiveMarkets();
      if (!markets.length) {
        onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'error', message: 'No markets found' });
        await sleep(15_000);
        continue;
      }

      const positions = await findOpenPositions(markets, smartAccountAddress);
      const shouldSell = positions.length > 0 && (Math.random() < sellChance || positions.length >= settings.maxPositions);

      if (shouldSell) {
        const pos = positions[randInt(0, positions.length - 1)];
        const outcome = pos.side === 'YES' ? 1n : 2n;
        let sharesToSell = pos.shares;
        if (Math.random() < 0.3 && pos.shares > 100_000n) {
          sharesToSell = (pos.shares * BigInt(randInt(40, 80))) / 100n;
        }
        try {
          const res = await sell({ privateKey, smartAccountAddress, market: pos.market, outcome, shares: sharesToSell, slippageBps: 300 });
          sellCount++;
          onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'sell', message: `SELL ${pos.side} "${pos.marketTitle.slice(0, 30)}" → +${fmtUsdc(res.quote.usdcReturn)} USDC` });
        } catch {
          onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'error', message: `Sell failed` });
        }
      } else {
        const positionMarkets = new Set(positions.map(p => p.market.toLowerCase()));
        const available = markets.filter((m: any) => !positionMarkets.has((m.address ?? m.id).toLowerCase()));
        const pool = available.length > 0 ? available : markets;
        const market = pool[randInt(0, pool.length - 1)];
        const side = Math.random() < yesChance ? 'YES' : 'NO';
        const rawAmt = rand(settings.minUsdc, settings.maxUsdc);
        const amount = Math.round(rawAmt * 1000) / 1000;
        const outcome = side === 'YES' ? 1n : 2n;
        const usdcAmount = parseUnits(String(amount), USDC_DECIMALS);
        const title = (market.title ?? 'Unknown').slice(0, 30);

        try {
          const res = await buy({ privateKey, smartAccountAddress, market: getAddress(market.address ?? market.id), outcome, usdcAmount, slippageBps: 300 });
          buyCount++;
          onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'buy', message: `BUY ${side} "${title}" — $${amount} → ${fmtUsdc(res.quote.shares)} shares` });
        } catch {
          onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'error', message: `Buy failed` });
        }
      }

      if (i < settings.rounds - 1 && !signal.aborted) {
        const delay = randInt(settings.minDelaySec * 1000, settings.maxDelaySec * 1000);
        onProgress({ round: i + 1, totalRounds: settings.rounds, action: 'waiting', message: `Next in ${(delay / 1000).toFixed(0)}s...` });
        await sleepWithAbort(delay);
      }
    }
  }

  const finalBal = await getUsdcBalance(smartAccountAddress);
  onProgress({ round: settings.rounds, totalRounds: settings.rounds, action: 'done', message: `Done! ${buyCount + sellCount} trades (${buyCount} buys, ${sellCount} sells)\nFinal: ${fmtUsdc(finalBal)} USDC` });
}
