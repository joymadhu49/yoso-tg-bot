import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot.js';
import { getUser } from '../db.js';
import { getUsdcBalance, fmtUsdc, getSharesBalance } from '../engine/trading.js';
import { listMarkets } from '../engine/api.js';
import { getAddress, type Address } from 'viem';
import { safeEdit, esc, roundShares } from '../helpers.js';

export async function showBalance(ctx: BotContext): Promise<void> {
  const user = getUser(ctx.from!.id);
  if (!user) return;

  await safeEdit(ctx, '⏳ Loading balance...');

  const smartAccount = user.smart_account as Address;
  let balText = '...';
  let posText = '';
  let posCount = 0;
  let totalValue = 0;

  try {
    const bal = await getUsdcBalance(smartAccount);
    balText = roundShares(fmtUsdc(bal));
    totalValue = Number(balText);
  } catch {}

  try {
    const data = await listMarkets({ limit: 24, sort: 'trending' });
    const markets: any[] = data?.data ?? data?.markets ?? data ?? [];

    for (const m of markets) {
      if (!m.yesToken || !m.noToken) continue;

      try {
        const yb = await getSharesBalance(getAddress(m.yesToken), smartAccount);
        const nb = await getSharesBalance(getAddress(m.noToken), smartAccount);
        const title = esc((m.title ?? 'Unknown').slice(0, 35));

        if (yb > 0n) {
          const sharesStr = roundShares(fmtUsdc(yb));
          const price = Number(m.yesPrice ?? 0);
          const value = Number(sharesStr) * price;
          posText += `\n  ✅ ${title}\n     *${sharesStr}* YES · ~$${value.toFixed(3)}`;
          totalValue += value;
          posCount++;
        }
        if (nb > 0n) {
          const sharesStr = roundShares(fmtUsdc(nb));
          const price = Number(m.noPrice ?? 0);
          const value = Number(sharesStr) * price;
          posText += `\n  ❌ ${title}\n     *${sharesStr}* NO · ~$${value.toFixed(3)}`;
          totalValue += value;
          posCount++;
        }
      } catch {}
    }
  } catch {}

  let text = `🏦 *Your Account*\n\n💰 USDC: *${balText}*`;
  if (posText) {
    text += `\n\n📊 Positions (${posCount}):${posText}`;
  } else {
    text += `\n\n📊 No open positions`;
  }
  text += `\n\n💎 Total: ~*$${totalValue.toFixed(2)}*`;

  const kb = new InlineKeyboard()
    .text('📊 Markets', 'mk:1').text('💸 Sell', 'sl')
    .row()
    .text('🔄 Refresh', 'bl').text('🔙 Menu', 'm');

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}
