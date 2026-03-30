import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot.js';
import { isAutoRunning, setAutoAbort, clearAutoAbort } from '../bot.js';
import { getUser, getUserPrivateKey, getUserSettings } from '../db.js';
import { autoTrade, type AutoTradeSettings, type TradingMode } from '../engine/auto-trade.js';
import { getUsdcBalance, fmtUsdc } from '../engine/trading.js';
import type { Address } from 'viem';
import { safeEdit, esc } from '../helpers.js';

function roundNum(n: string | number): string {
  return Number(n).toFixed(4).replace(/\.?0+$/, '');
}

export async function showAutoTrade(ctx: BotContext): Promise<void> {
  const userId = ctx.from!.id;
  const settings = getUserSettings(userId);
  const running = isAutoRunning(userId);

  const mode = settings.mode ?? 'flip';
  const modeLabel = mode === 'flip' ? '🔄 Buy & Flip' : '📊 Mixed';
  const modeDesc = mode === 'flip'
    ? 'Buy → hold briefly → sell same'
    : 'Random buys & sells on different markets';

  const text =
    `🤖 *Auto-Trade*\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `🎮 Mode: *${modeLabel}*\n` +
    `_${modeDesc}_\n\n` +
    `📊 Rounds: *${settings.rounds}*\n` +
    `⏱ Delay: *${settings.min_delay_sec}s – ${settings.max_delay_sec}s*\n` +
    `💰 Amount: *$${settings.min_usdc} – $${settings.max_usdc}*\n` +
    `🎯 YES *${settings.yes_chance}%*` +
    (mode === 'mixed' ? ` · Sell *${settings.sell_chance}%*` : '') +
    (running ? '\n\n⚡ *Running...*' : '');

  const kb = new InlineKeyboard();
  if (running) {
    kb.text('⏹ Stop', 'ax');
  } else {
    kb.text('▶️ Start Trading', 'as');
    kb.row();
    // Mode toggle
    if (mode === 'flip') {
      kb.text('🔄 Flip Mode ✓', 'tm:flip').text('📊 Mixed', 'tm:mixed');
    } else {
      kb.text('🔄 Flip', 'tm:flip').text('📊 Mixed ✓', 'tm:mixed');
    }
    kb.row();
    kb.text('⚙️ Edit Settings', 'ts');
  }
  kb.row().text('🔙 Menu', 'm');

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function startAutoTrade(ctx: BotContext): Promise<void> {
  const userId = ctx.from!.id;

  if (isAutoRunning(userId)) {
    await ctx.answerCallbackQuery({ text: 'Already running!', show_alert: true });
    return;
  }

  const user = getUser(userId);
  const privateKey = getUserPrivateKey(userId);
  if (!user || !privateKey) return;

  const dbSettings = getUserSettings(userId);
  const settings: AutoTradeSettings = {
    rounds: dbSettings.rounds,
    minDelaySec: dbSettings.min_delay_sec,
    maxDelaySec: dbSettings.max_delay_sec,
    minUsdc: dbSettings.min_usdc,
    maxUsdc: dbSettings.max_usdc,
    yesChance: dbSettings.yes_chance,
    sellChance: dbSettings.sell_chance,
    maxPositions: dbSettings.max_positions,
    mode: (dbSettings.mode ?? 'flip') as TradingMode,
  };

  const controller = new AbortController();
  setAutoAbort(userId, controller);

  const chatId = ctx.chat!.id;
  const smartAccount = user.smart_account as Address;

  // Get starting balance
  let startBal = '?';
  try {
    const bal = await getUsdcBalance(smartAccount);
    startBal = roundNum(fmtUsdc(bal));
  } catch {}

  // Send status message
  const stopKb = new InlineKeyboard().text('⏹ Stop', 'ax');
  const statusMsg = await ctx.reply(
    `🤖 *Auto-Trade Starting*\n━━━━━━━━━━━━━━━\n\n💰 Balance: *${startBal} USDC*\n⏳ Preparing...`,
    { parse_mode: 'Markdown', reply_markup: stopKb },
  );
  const msgId = statusMsg.message_id;
  ctx.session.lastBotMsgId = msgId;

  const lines: string[] = [];
  let buys = 0;
  let sells = 0;
  let errors = 0;

  function buildStatus(round: number, total: number, footer: string = ''): string {
    const progress = `${'█'.repeat(Math.round((round / total) * 10))}${'░'.repeat(10 - Math.round((round / total) * 10))}`;
    const header = `🤖 *Auto-Trade* \\[${round}/${total}\\]\n${progress}\n`;
    const recent = lines.slice(-6).join('\n');
    const stats = `\n📈 ${buys} buys · 📉 ${sells} sells${errors > 0 ? ` · ❌ ${errors}` : ''}`;
    return header + '\n' + recent + stats + (footer ? '\n\n' + footer : '');
  }

  autoTrade(
    privateKey,
    smartAccount,
    settings,
    (p) => {
      if (p.action === 'done') {
        getUsdcBalance(smartAccount).then((endBal) => {
          const endStr = roundNum(fmtUsdc(endBal));
          const diff = (Number(endStr) - Number(startBal)).toFixed(4);
          const diffSign = Number(diff) >= 0 ? '+' : '';

          const finalText =
            `🏁 *Auto-Trade Complete!*\n━━━━━━━━━━━━━━━\n\n` +
            lines.slice(-8).join('\n') + '\n\n' +
            `📊 *${buys + sells} trades* (${buys} buys, ${sells} sells)\n` +
            `💰 ${startBal} → *${endStr} USDC* (${diffSign}${diff})`;

          const kb = new InlineKeyboard()
            .text('🔄 Run Again', 'at').text('🏦 Balance', 'bl')
            .row().text('🔙 Menu', 'm');

          ctx.api.editMessageText(chatId, msgId, finalText, { parse_mode: 'Markdown', reply_markup: kb }).catch(() => {
            ctx.api.sendMessage(chatId, finalText, { parse_mode: 'Markdown', reply_markup: kb }).catch(() => {});
          });
        }).catch(() => {
          const finalText =
            `🏁 *Auto-Trade Complete!*\n━━━━━━━━━━━━━━━\n\n` +
            `📊 *${buys + sells} trades* (${buys} buys, ${sells} sells)`;

          const kb = new InlineKeyboard()
            .text('🔄 Run Again', 'at').text('🏦 Balance', 'bl')
            .row().text('🔙 Menu', 'm');

          ctx.api.editMessageText(chatId, msgId, finalText, { parse_mode: 'Markdown', reply_markup: kb }).catch(() => {});
        });
        return;
      }

      if (p.action === 'waiting') {
        const text = buildStatus(p.round, p.totalRounds, `⏳ ${esc(p.message)}`);
        ctx.api.editMessageText(chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: stopKb }).catch(() => {});
        return;
      }

      if (p.action === 'error') {
        errors++;
        lines.push(`❌ ${p.round}. ${esc(p.message)}`);
      } else {
        const emoji = p.action === 'buy' ? '📈' : '📉';
        if (p.action === 'buy') buys++;
        if (p.action === 'sell') sells++;
        lines.push(`${emoji} ${p.round}. ${esc(p.message)}`);
      }

      const text = buildStatus(p.round, p.totalRounds);
      ctx.api.editMessageText(chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: stopKb }).catch(() => {});
    },
    controller.signal,
  ).catch(() => {
    const text = `❌ Auto-trade error. Please try again.`;
    const kb = new InlineKeyboard().text('🤖 Auto', 'at').text('🔙 Menu', 'm');
    ctx.api.editMessageText(chatId, msgId, text, { reply_markup: kb }).catch(() => {});
  }).finally(() => {
    clearAutoAbort(userId);
  });
}

export async function stopAutoTrade(ctx: BotContext): Promise<void> {
  const userId = ctx.from!.id;
  clearAutoAbort(userId);

  const text =
    `⏹ *Auto-trade stopped*\n\n` +
    `Trades completed before stop are saved.`;

  const kb = new InlineKeyboard()
    .text('🤖 Auto', 'at').text('🏦 Balance', 'bl')
    .row().text('🔙 Menu', 'm');

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}
