import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot.js';
import { checkRateLimit } from '../bot.js';
import { getUser, getUserPrivateKey } from '../db.js';
import { buy, quoteBuy, fmtUsdc } from '../engine/trading.js';
import { getAddress, parseUnits, type Address } from 'viem';
import { USDC_DECIMALS } from '../engine/config.js';
import { safeEdit, esc, roundShares, txLink, friendlyError } from '../helpers.js';

export async function showBuySide(ctx: BotContext): Promise<void> {
  const market = ctx.session.market;
  if (!market) return;

  const title = esc(market.title);
  const text = `💰 *Buy: ${title}*\n\nPick side:`;
  const kb = new InlineKeyboard()
    .text(`✅ YES (${Number(market.yesPrice || 0).toFixed(2)})`, 'bs:y')
    .text(`❌ NO (${Number(market.noPrice || 0).toFixed(2)})`, 'bs:n')
    .row()
    .text('🔙 Back', `md:${ctx.session.markets.indexOf(market)}`);

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function showBuyAmount(ctx: BotContext): Promise<void> {
  const market = ctx.session.market;
  const side = ctx.session.side;
  const sideEmoji = side === 'YES' ? '✅ YES' : '❌ NO';
  const title = market ? esc(market.title) : '';

  const text = `💰 *${sideEmoji}* on ${title}\n\nHow much USDC?`;
  const kb = new InlineKeyboard()
    .text('0.05', 'ba:0.05').text('0.07', 'ba:0.07').text('0.10', 'ba:0.10')
    .row()
    .text('0.15', 'ba:0.15').text('0.20', 'ba:0.20').text('Custom', 'ba:custom')
    .row()
    .text('🔙 Back', 'bs:pick');

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function showBuyConfirm(ctx: BotContext): Promise<void> {
  const market = ctx.session.market;
  const side = ctx.session.side;
  const amount = ctx.session.amount;
  if (!market || !side || !amount) return;

  const user = getUser(ctx.from!.id);
  if (!user) return;

  let quoteText = '';
  try {
    const outcome = side === 'YES' ? 1n : 2n;
    const usdcAmount = parseUnits(String(amount), USDC_DECIMALS);
    const q = await quoteBuy(getAddress(market.address), outcome, usdcAmount);
    quoteText = `Est. shares: *${roundShares(fmtUsdc(q.shares))}*\nFee: *${roundShares(fmtUsdc(q.fee))} USDC*`;
  } catch {
    quoteText = '_Quote unavailable_';
  }

  const sideEmoji = side === 'YES' ? '✅ YES' : '❌ NO';
  const title = esc(market.title);
  const text =
    `📋 *Buy Confirmation*\n\n` +
    `Market: ${title}\n` +
    `Side: ${sideEmoji}\n` +
    `Amount: *${amount} USDC*\n` +
    `${quoteText}`;

  const kb = new InlineKeyboard()
    .text('✅ Confirm', 'bc')
    .text('❌ Cancel', 'm');

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function executeBuy(ctx: BotContext): Promise<void> {
  const market = ctx.session.market;
  const side = ctx.session.side;
  const amount = ctx.session.amount;
  if (!market || !side || !amount) return;

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
    const outcome = side === 'YES' ? 1n : 2n;
    const usdcAmount = parseUnits(String(amount), USDC_DECIMALS);
    const smartAccount = user.smart_account as Address;

    const result = await buy({
      privateKey,
      smartAccountAddress: smartAccount,
      market: market.address,
      outcome,
      usdcAmount,
      slippageBps: 200,
    });

    const title = esc(market.title);
    const shares = roundShares(fmtUsdc(result.quote.shares));
    const fee = roundShares(fmtUsdc(result.quote.fee));
    const hash = result.txHash ?? result.userOpHash;
    const link = txLink(hash);

    const text =
      `✅ *Bought!*\n\n` +
      `*${shares}* ${side} shares on "${title}"\n` +
      `Spent: *${amount} USDC* · Fee: *${fee}*\n` +
      `${link}`;

    const kb = new InlineKeyboard()
      .text('📊 Markets', 'mk:1')
      .text('🏦 Balance', 'bl')
      .text('🔙 Menu', 'm');

    await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
  } catch (err: any) {
    const text = friendlyError(err);
    const kb = new InlineKeyboard()
      .text('🔄 Retry', 'bc')
      .text('🔙 Menu', 'm');
    await safeEdit(ctx, text, { reply_markup: kb });
  }
}
