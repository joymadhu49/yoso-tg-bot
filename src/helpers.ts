import { InlineKeyboard } from 'grammy';
import type { BotContext } from './bot.js';

/** Escape special Markdown characters in text (for parse_mode: 'Markdown') */
export function esc(text: string): string {
  return text.replace(/([_*\[\]`])/g, '\\$1');
}

/** Round a formatted USDC string to 4 decimal places max */
export function roundShares(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  // Remove trailing zeros
  return parseFloat(n.toFixed(4)).toString();
}

/** Basescan tx link (inline Markdown) */
export function txLink(hash: string): string {
  const full = hash.startsWith('0x') ? hash : `0x${hash}`;
  return `[View Tx](https://basescan.org/tx/${full})`;
}

/** Delete old bot message tracked in session, swallow errors */
export async function deleteOldMsg(ctx: BotContext): Promise<void> {
  const msgId = ctx.session.lastBotMsgId;
  if (msgId && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, msgId).catch(() => {});
    ctx.session.lastBotMsgId = null;
  }
}

/** Safe editMessageText with fallback to ctx.reply. Tracks lastBotMsgId. */
export async function safeEdit(
  ctx: BotContext,
  text: string,
  opts?: { parse_mode?: string; reply_markup?: InlineKeyboard },
): Promise<void> {
  try {
    if (ctx.callbackQuery) {
      const msg = await ctx.editMessageText(text, opts as any);
      if (msg && typeof msg === 'object' && 'message_id' in msg) {
        ctx.session.lastBotMsgId = (msg as any).message_id;
      }
    } else {
      await deleteOldMsg(ctx);
      const msg = await ctx.reply(text, opts as any);
      ctx.session.lastBotMsgId = msg.message_id;
    }
  } catch {
    try {
      await deleteOldMsg(ctx);
      const msg = await ctx.reply(text, opts as any);
      ctx.session.lastBotMsgId = msg.message_id;
    } catch { /* last resort — ignore */ }
  }
}

/** Send a new message (not editing). Deletes old msg, tracks new one. */
export async function safeSend(
  ctx: BotContext,
  text: string,
  opts?: { parse_mode?: string; reply_markup?: InlineKeyboard },
): Promise<number> {
  await deleteOldMsg(ctx);
  const msg = await ctx.reply(text, opts as any);
  ctx.session.lastBotMsgId = msg.message_id;
  return msg.message_id;
}

/** Friendly error message from raw error */
export function friendlyError(err: any): string {
  const msg = (err?.message ?? err?.toString() ?? 'Unknown error').toLowerCase();
  if (msg.includes('insufficient') || msg.includes('not enough') || msg.includes('exceeds balance')) {
    return '💰 Insufficient balance. Check your USDC and try again.';
  }
  if (msg.includes('execution reverted') || msg.includes('revert')) {
    return '⚠️ Trade couldn\'t complete. The market may have moved. Try again.';
  }
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch') || msg.includes('econnrefused')) {
    return '🔌 Connection issue. Please try again.';
  }
  if (msg.includes('rate limit') || msg.includes('429')) {
    return '⏳ Rate limited. Please wait a moment and try again.';
  }
  return `⚠️ Something went wrong. Please try again.`;
}
