import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot.js';
import { getUserSettings } from '../db.js';
import { safeEdit, safeSend } from '../helpers.js';

type SettingDef = {
  key: string;
  label: string;
  description: string;
  format: (v: number) => string;
};

const SETTINGS_DEFS: SettingDef[] = [
  { key: 'rounds', label: 'Rounds', description: 'How many trades to make per session.', format: (v) => `${v}` },
  { key: 'min_delay_sec', label: 'Min delay', description: 'Minimum seconds between trades.', format: (v) => `${v}s` },
  { key: 'max_delay_sec', label: 'Max delay', description: 'Maximum seconds between trades.', format: (v) => `${v}s` },
  { key: 'min_usdc', label: 'Min $', description: 'Minimum USDC per trade.', format: (v) => `$${v}` },
  { key: 'max_usdc', label: 'Max $', description: 'Maximum USDC per trade.', format: (v) => `$${v}` },
  { key: 'yes_chance', label: 'YES %', description: 'Probability of buying YES vs NO (0-100).', format: (v) => `${v}%` },
  { key: 'sell_chance', label: 'Sell %', description: 'Probability of selling instead of buying (0-100).', format: (v) => `${v}%` },
  { key: 'max_positions', label: 'Max pos', description: 'Max open positions before forced sells.', format: (v) => `${v}` },
];

function buildSettingsMessage(userId: number): { text: string; kb: InlineKeyboard } {
  const settings = getUserSettings(userId);

  let text = '⚙️ *Auto-Trade Settings*\n\n';
  for (const def of SETTINGS_DEFS) {
    const val = (settings as any)[def.key] as number;
    text += `• ${def.label}: *${def.format(val)}*\n`;
  }
  text += '\nTap to change:';

  const kb = new InlineKeyboard();
  // 2 buttons per row for compact layout
  for (let i = 0; i < SETTINGS_DEFS.length; i += 2) {
    const d1 = SETTINGS_DEFS[i];
    const v1 = (settings as any)[d1.key];
    kb.text(`${d1.label}: ${d1.format(v1)}`, `te:${d1.key}`);
    if (i + 1 < SETTINGS_DEFS.length) {
      const d2 = SETTINGS_DEFS[i + 1];
      const v2 = (settings as any)[d2.key];
      kb.text(`${d2.label}: ${d2.format(v2)}`, `te:${d2.key}`);
    }
    kb.row();
  }
  kb.text('🔙 Back to Auto', 'at');

  return { text, kb };
}

export async function showSettings(ctx: BotContext): Promise<void> {
  const { text, kb } = buildSettingsMessage(ctx.from!.id);
  await safeEdit(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function showSettingsAsNew(ctx: BotContext): Promise<void> {
  const { text, kb } = buildSettingsMessage(ctx.from!.id);
  await safeSend(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export function getSettingLabel(key: string): string {
  const def = SETTINGS_DEFS.find(d => d.key === key);
  return def?.label ?? key;
}

export function getSettingDescription(key: string): string {
  const def = SETTINGS_DEFS.find(d => d.key === key);
  return def?.description ?? '';
}

export function getSettingCurrentValue(userId: number, key: string): string {
  const settings = getUserSettings(userId);
  const def = SETTINGS_DEFS.find(d => d.key === key);
  if (!def) return '';
  const val = (settings as any)[key] as number;
  return def.format(val);
}
