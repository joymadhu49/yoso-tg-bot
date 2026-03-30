import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot.js';
import { listMarkets } from '../engine/api.js';
import { safeEdit, esc } from '../helpers.js';

const PAGE_SIZE = 5;

function toNum(v: any): number {
  return Number(v ?? 0) || 0;
}

export async function showMarkets(ctx: BotContext, page: number): Promise<void> {
  const data = await listMarkets({ page, limit: PAGE_SIZE, sort: 'trending' });
  const markets: any[] = data?.data ?? data?.markets ?? data ?? [];

  ctx.session.markets = markets.map((m: any) => ({
    address: m.address ?? m.id,
    title: (m.title ?? 'Unknown').slice(0, 60),
    yesPrice: toNum(m.yesPrice),
    noPrice: toNum(m.noPrice),
    yesToken: m.yesToken ?? '',
    noToken: m.noToken ?? '',
    volume: toNum(m.totalVolume ?? m.volume),
  }));
  ctx.session.page = page;

  let text = '📊 *Trending Markets*\n\n';
  markets.forEach((m: any, i: number) => {
    const title = esc((m.title ?? 'Unknown').slice(0, 55));
    const yp = toNum(m.yesPrice).toFixed(2);
    const np = toNum(m.noPrice).toFixed(2);
    const vol = toNum(m.totalVolume ?? m.volume);
    const volStr = vol >= 1_000_000 ? `$${(vol / 1_000_000).toFixed(0)}M` : `$${Math.round(vol / 1000)}K`;
    text += `${i + 1}. ${title}\n   YES *${yp}* · NO *${np}* · ${volStr}\n\n`;
  });

  const kb = new InlineKeyboard();
  for (let i = 0; i < markets.length; i++) {
    kb.text(`${i + 1}`, `md:${i}`);
  }
  kb.row();
  if (page > 1) kb.text('◀ Prev', `mk:${page - 1}`);
  kb.text('Next ▶', `mk:${page + 1}`);
  kb.row();
  kb.text('🔙 Back', 'm');

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function showMarketDetail(ctx: BotContext, idx: number): Promise<void> {
  const market = ctx.session.markets[idx];
  if (!market) return;

  ctx.session.market = market;

  const title = esc(market.title);
  const yp = toNum(market.yesPrice).toFixed(2);
  const np = toNum(market.noPrice).toFixed(2);
  const vol = toNum(market.volume);
  const volStr = vol >= 1_000_000 ? `$${(vol / 1_000_000).toFixed(1)}M` : `$${Math.round(vol / 1000)}K`;

  const text =
    `📊 *${title}*\n\n` +
    `✅ YES: *${yp}*\n` +
    `❌ NO: *${np}*\n` +
    `📈 Volume: *${volStr}*`;

  const kb = new InlineKeyboard()
    .text('💰 Buy', `bs:pick`)
    .text('💸 Sell', `sp:this`)
    .row()
    .text('🔙 Back', `mk:${ctx.session.page}`);

  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}
