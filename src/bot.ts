import { Bot, session, type Context, type SessionFlavor } from 'grammy';

export type SessionData = {
  // Market browsing
  markets: any[];
  page: number;
  // Buy flow
  market: any | null;
  side: 'YES' | 'NO' | null;
  amount: number | null;
  // Sell flow
  positions: any[];
  posIdx: number;
  sellShares: string | null; // 'all', 'half', or bigint string
  // Input state
  awaitingInput: string | null;
  editingSetting: string | null;
  // Message tracking
  lastBotMsgId: number | null;
};

export type BotContext = Context & SessionFlavor<SessionData>;

function initialSession(): SessionData {
  return {
    markets: [],
    page: 1,
    market: null,
    side: null,
    amount: null,
    positions: [],
    posIdx: 0,
    sellShares: null,
    awaitingInput: null,
    editingSetting: null,
    lastBotMsgId: null,
  };
}

export function createBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  bot.use(session({ initial: initialSession }));

  // DM-only middleware
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return;
    await next();
  });

  return bot;
}

// Rate limiter: 1 trade per 10s per user
const lastTrade = new Map<number, number>();

export function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const last = lastTrade.get(userId) ?? 0;
  if (now - last < 10_000) return false;
  lastTrade.set(userId, now);
  return true;
}

// Auto-trade abort controllers per user
const autoAbortControllers = new Map<number, AbortController>();

export function getAutoAbort(userId: number): AbortController | undefined {
  return autoAbortControllers.get(userId);
}

export function setAutoAbort(userId: number, controller: AbortController): void {
  autoAbortControllers.set(userId, controller);
}

export function clearAutoAbort(userId: number): void {
  const c = autoAbortControllers.get(userId);
  if (c) c.abort();
  autoAbortControllers.delete(userId);
}

export function isAutoRunning(userId: number): boolean {
  const c = autoAbortControllers.get(userId);
  return !!c && !c.signal.aborted;
}
