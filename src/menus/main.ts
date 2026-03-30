import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot.js';
import { getUser } from '../db.js';
import { getUsdcBalance, fmtUsdc } from '../engine/trading.js';
import { type Address } from 'viem';
import { safeEdit, safeSend } from '../helpers.js';

const ADMIN_ID = Number(process.env.ADMIN_ID ?? 0);

export function welcomeKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('🔐 Setup Wallet', 'sw');
}

export function mainMenuKeyboard(isAdmin: boolean = false): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text('📊 Markets', 'mk:1').text('💰 Buy', 'mk:1')
    .row()
    .text('💸 Sell', 'sl').text('📤 Sell All', 'sa:all_positions')
    .row()
    .text('🤖 Auto', 'at').text('⚙️ Settings', 'ts')
    .row()
    .text('🏦 Balance', 'bl');

  if (isAdmin) {
    kb.row().text('👑 Admin', 'admin');
  }

  return kb;
}

export async function sendWelcome(ctx: BotContext): Promise<void> {
  const text =
    `🎯 *Welcome to Yoso Bot!*\n\n` +
    `Trade prediction markets on Base chain.\n` +
    `✅ Zero gas fees (paymaster sponsored)\n` +
    `✅ Buy & sell YES/NO shares\n` +
    `✅ Auto-trade mode\n\n` +
    `Tap below to connect your wallet:`;

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: welcomeKeyboard() });
}

export async function sendMainMenu(ctx: BotContext): Promise<void> {
  const user = getUser(ctx.from!.id);
  if (!user) {
    await sendWelcome(ctx);
    return;
  }

  const isAdmin = ctx.from!.id === ADMIN_ID;

  let balanceText = '...';
  try {
    const bal = await getUsdcBalance(user.smart_account as Address);
    balanceText = fmtUsdc(bal);
  } catch { /* keep ... */ }

  const text =
    `🎯 *Yoso Bot*\n\n` +
    `💰 Balance: *${balanceText} USDC*\n` +
    `📍 ${(user.smart_account as string).slice(0, 6)}...${(user.smart_account as string).slice(-4)}`;

  const kb = mainMenuKeyboard(isAdmin);

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}
