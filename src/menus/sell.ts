import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot.js';
import { checkRateLimit } from '../bot.js';
import { getUser, getUserPrivateKey } from '../db.js';
import { sell, quoteSell, fmtUsdc, getSharesBalance, getUsdcBalance } from '../engine/trading.js';
import { listMarkets } from '../engine/api.js';
import { getAddress, type Address } from 'viem';
import { safeEdit, safeSend, esc, roundShares, txLink, friendlyError } from '../helpers.js';

type PositionInfo = {
  market: string;
  title: string;
  side: 'YES' | 'NO';
  shares: string; // bigint as string for session storage
  yesToken: string;
  noToken: string;
};

async function loadPositions(smartAccount: Address): Promise<PositionInfo[]> {
  const data = await listMarkets({ limit: 24, sort: 'trending' });
  const markets: any[] = data?.data ?? data?.markets ?? data ?? [];
  const positions: PositionInfo[] = [];

  for (const m of markets) {
    const addr = m.address ?? m.id;
    const yesToken = m.yesToken;
    const noToken = m.noToken;
    if (!yesToken || !noToken) continue;
    try {
      const yb = await getSharesBalance(getAddress(yesToken), smartAccount);
      const nb = await getSharesBalance(getAddress(noToken), smartAccount);
      if (yb > 0n) {
        positions.push({ market: addr, title: (m.title ?? 'Unknown').slice(0, 50), side: 'YES', shares: yb.toString(), yesToken, noToken });
      }
      if (nb > 0n) {
        positions.push({ market: addr, title: (m.title ?? 'Unknown').slice(0, 50), side: 'NO', shares: nb.toString(), yesToken, noToken });
      }
    } catch { /* skip */ }
  }
  return positions;
}

export async function showPositions(ctx: BotContext): Promise<void> {
  const user = getUser(ctx.from!.id);
  if (!user) return;

  await safeEdit(ctx, '⏳ Loading positions...');

  const positions = await loadPositions(user.smart_account as Address);
  ctx.session.positions = positions;

  if (positions.length === 0) {
    const kb = new InlineKeyboard()
      .text('📊 Markets', 'mk:1')
      .text('🔙 Back', 'm');
    await safeEdit(ctx, '💸 No open positions found.', { reply_markup: kb });
    return;
  }

  let text = '💸 *Your Positions*\n\n';
  positions.forEach((p, i) => {
    const title = esc(p.title);
    const shares = roundShares(fmtUsdc(BigInt(p.shares)));
    text += `${i + 1}. ${title}\n   *${shares}* ${p.side} shares\n\n`;
  });

  const kb = new InlineKeyboard();
  for (let i = 0; i < positions.length && i < 8; i++) {
    kb.text(`${i + 1}`, `si:${i}`);
  }
  kb.row().text('🔙 Back', 'm');

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function showSellOptions(ctx: BotContext, idx: number): Promise<void> {
  const pos = ctx.session.positions[idx] as PositionInfo | undefined;
  if (!pos) return;
  ctx.session.posIdx = idx;

  const title = esc(pos.title);
  const shares = roundShares(fmtUsdc(BigInt(pos.shares)));

  const text =
    `💸 *Sell: ${title}*\n\n` +
    `You have: *${shares}* ${pos.side} shares`;

  const kb = new InlineKeyboard()
    .text('Sell All', 'sa:all')
    .text('Sell Half', 'sa:half')
    .text('Custom', 'sa:custom')
    .row()
    .text('🔙 Back', 'sl');

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function showSellConfirm(ctx: BotContext): Promise<void> {
  const pos = ctx.session.positions[ctx.session.posIdx] as PositionInfo | undefined;
  if (!pos || !ctx.session.sellShares) return;

  const shares = BigInt(ctx.session.sellShares);
  const outcome = pos.side === 'YES' ? 1n : 2n;

  let quoteText = '';
  try {
    const q = await quoteSell(getAddress(pos.market), outcome, shares);
    quoteText = `Est. return: *${roundShares(fmtUsdc(q.usdcReturn))} USDC*\nFee: *${roundShares(fmtUsdc(q.fee))} USDC*`;
  } catch {
    quoteText = '_Quote unavailable_';
  }

  const title = esc(pos.title);
  const text =
    `📋 *Sell Confirmation*\n\n` +
    `Market: ${title}\n` +
    `Side: ${pos.side}\n` +
    `Shares: *${roundShares(fmtUsdc(shares))}*\n` +
    `${quoteText}`;

  const kb = new InlineKeyboard()
    .text('✅ Confirm', 'sc')
    .text('❌ Cancel', 'm');

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function executeSell(ctx: BotContext): Promise<void> {
  const pos = ctx.session.positions[ctx.session.posIdx] as PositionInfo | undefined;
  if (!pos || !ctx.session.sellShares) return;

  const userId = ctx.from!.id;
  if (!checkRateLimit(userId)) {
    await ctx.answerCallbackQuery({ text: 'Rate limit: 1 trade per 10s', show_alert: true });
    return;
  }

  const privateKey = getUserPrivateKey(userId);
  const user = getUser(userId);
  if (!privateKey || !user) return;

  await safeEdit(ctx, '⏳ Sending trade...');

  try {
    const shares = BigInt(ctx.session.sellShares);
    const outcome = pos.side === 'YES' ? 1n : 2n;
    const smartAccount = user.smart_account as Address;

    const result = await sell({
      privateKey,
      smartAccountAddress: smartAccount,
      market: pos.market,
      outcome,
      shares,
      slippageBps: 200,
    });

    const title = esc(pos.title);
    const sharesStr = roundShares(fmtUsdc(shares));
    const usdcReturn = roundShares(fmtUsdc(result.quote.usdcReturn));
    const hash = result.txHash ?? result.userOpHash;
    const link = txLink(hash);

    const text =
      `✅ *Sold!*\n\n` +
      `*${sharesStr}* ${pos.side} shares on "${title}"\n` +
      `Received: *${usdcReturn} USDC*\n` +
      `${link}`;

    const kb = new InlineKeyboard()
      .text('💸 Sell More', 'sl')
      .text('🏦 Balance', 'bl')
      .text('🔙 Menu', 'm');

    await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
  } catch (err: any) {
    const text = friendlyError(err);
    const kb = new InlineKeyboard()
      .text('🔄 Retry', 'sc')
      .text('🔙 Menu', 'm');
    await safeEdit(ctx, text, { reply_markup: kb });
  }
}

// --- Sell All Feature ---

export async function showSellAllConfirm(ctx: BotContext): Promise<void> {
  const user = getUser(ctx.from!.id);
  if (!user) return;

  await safeEdit(ctx, '⏳ Scanning positions...');

  const positions = await loadPositions(user.smart_account as Address);
  ctx.session.positions = positions;

  if (positions.length === 0) {
    const kb = new InlineKeyboard()
      .text('📊 Markets', 'mk:1')
      .text('🔙 Menu', 'm');
    await safeEdit(ctx, '💸 No positions to sell.', { reply_markup: kb });
    return;
  }

  let text = `📤 *Sell All Positions*\n\nFound *${positions.length}* position(s):\n\n`;
  for (const p of positions) {
    const title = esc(p.title);
    const shares = roundShares(fmtUsdc(BigInt(p.shares)));
    text += `• ${title} — *${shares}* ${p.side}\n`;
  }
  text += `\nSell everything?`;

  const kb = new InlineKeyboard()
    .text('✅ Confirm Sell All', 'sa:confirm_all')
    .row()
    .text('❌ Cancel', 'm');

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function executeSellAll(ctx: BotContext): Promise<void> {
  const userId = ctx.from!.id;
  const privateKey = getUserPrivateKey(userId);
  const user = getUser(userId);
  if (!privateKey || !user) return;

  const positions = ctx.session.positions as PositionInfo[];
  if (!positions || positions.length === 0) return;

  const smartAccount = user.smart_account as Address;
  const chatId = ctx.chat!.id;

  let startBal = 0n;
  try { startBal = await getUsdcBalance(smartAccount); } catch {}

  const total = positions.length;
  let sold = 0;
  let failed = 0;
  const lines: string[] = [];

  // Send initial progress message
  const msgId = await safeSend(ctx, `📤 *Sell All* \\[0/${total}\\]\n\n⏳ Starting...`, { parse_mode: 'Markdown' });

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const title = esc(p.title);
    const shares = BigInt(p.shares);
    const outcome = p.side === 'YES' ? 1n : 2n;

    // Update progress
    const progressText =
      `📤 *Sell All* \\[${i + 1}/${total}\\]\n\n` +
      lines.join('\n') +
      (lines.length > 0 ? '\n' : '') +
      `⏳ Selling ${title}...`;

    try {
      await ctx.api.editMessageText(chatId, msgId, progressText, { parse_mode: 'Markdown' });
    } catch { /* ignore edit failures */ }

    try {
      const result = await sell({
        privateKey,
        smartAccountAddress: smartAccount,
        market: p.market,
        outcome,
        shares,
        slippageBps: 200,
      });
      const usdcReturn = roundShares(fmtUsdc(result.quote.usdcReturn));
      const hash = result.txHash ?? result.userOpHash;
      lines.push(`✅ ${title} — +${usdcReturn} USDC ${txLink(hash)}`);
      sold++;
    } catch {
      lines.push(`❌ ${title} — failed`);
      failed++;
    }
  }

  let endBal = 0n;
  try { endBal = await getUsdcBalance(smartAccount); } catch {}

  const startStr = roundShares(fmtUsdc(startBal));
  const endStr = roundShares(fmtUsdc(endBal));

  const finalText =
    `🏁 *Sell All Complete!*\n\n` +
    lines.join('\n') + '\n\n' +
    `📊 ${sold} sold, ${failed} failed\n` +
    `💰 ${startStr} USDC → *${endStr} USDC*`;

  const kb = new InlineKeyboard()
    .text('🏦 Balance', 'bl')
    .text('🔙 Menu', 'm');

  try {
    await ctx.api.editMessageText(chatId, msgId, finalText, { parse_mode: 'Markdown', reply_markup: kb });
  } catch {
    try { await ctx.api.sendMessage(chatId, finalText, { parse_mode: 'Markdown', reply_markup: kb }); } catch {}
  }
}
