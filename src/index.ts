import 'dotenv/config';
import { createBot, type BotContext } from './bot.js';
import { getDb, getUser, saveUser, getUserPrivateKey, updateSetting } from './db.js';
import { sendWelcome, sendMainMenu } from './menus/main.js';
import { showMarkets, showMarketDetail } from './menus/markets.js';
import { showBuySide, showBuyAmount, showBuyConfirm, executeBuy } from './menus/buy.js';
import { showPositions, showSellOptions, showSellConfirm, executeSell, showSellAllConfirm, executeSellAll } from './menus/sell.js';
import { showBalance } from './menus/balance.js';
import { showAutoTrade, startAutoTrade, stopAutoTrade } from './menus/auto.js';
import { showSettings, getSettingLabel, showSettingsAsNew, getSettingDescription, getSettingCurrentValue } from './menus/settings.js';
import { safeEdit, safeSend, esc, roundShares, friendlyError } from './helpers.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN env var required');

// Initialize database
getDb();

const bot = createBot(BOT_TOKEN);

// /start command
bot.command('start', async (ctx) => {
  const user = getUser(ctx.from!.id);
  if (user) {
    await sendMainMenu(ctx);
  } else {
    await sendWelcome(ctx);
  }
});

// Handle text input (for wallet setup, custom amounts, settings)
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from!.id;
  const awaiting = ctx.session.awaitingInput;

  if (!awaiting) return; // Ignore random text

  if (awaiting === 'private_key') {
    // Validate private key format
    const pk = text.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
      const msg = await ctx.reply('❌ Invalid private key format. Must start with 0x followed by 64 hex characters.\n\nPlease try again:');
      ctx.session.lastBotMsgId = msg.message_id;
      return;
    }
    // Store temporarily in session, ask for smart account next
    ctx.session.awaitingInput = 'smart_account';
    // Store pk in session temporarily (we'll encrypt on save)
    (ctx.session as any)._tempPk = pk;
    // Delete the message containing the private key for security
    await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
    const msg = await ctx.reply('✅ Key received (message deleted for security).\n\nNow send your smart account address:');
    ctx.session.lastBotMsgId = msg.message_id;
    return;
  }

  if (awaiting === 'smart_account') {
    const addr = text.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      const msg = await ctx.reply('❌ Invalid address format. Must start with 0x followed by 40 hex characters.\n\nPlease try again:');
      ctx.session.lastBotMsgId = msg.message_id;
      return;
    }
    const pk = (ctx.session as any)._tempPk;
    if (!pk) {
      ctx.session.awaitingInput = null;
      const msg = await ctx.reply('❌ Session expired. Please try setup again.');
      ctx.session.lastBotMsgId = msg.message_id;
      return;
    }
    saveUser(userId, pk, addr);
    delete (ctx.session as any)._tempPk;
    ctx.session.awaitingInput = null;
    const msg = await ctx.reply('✅ Wallet configured successfully!');
    ctx.session.lastBotMsgId = msg.message_id;
    await sendMainMenu(ctx);
    return;
  }

  if (awaiting === 'custom_buy_amount') {
    const amount = parseFloat(text.trim());
    if (isNaN(amount) || amount <= 0 || amount > 100) {
      const msg = await ctx.reply('❌ Invalid amount. Enter a number between 0.01 and 100:');
      ctx.session.lastBotMsgId = msg.message_id;
      return;
    }
    ctx.session.amount = amount;
    ctx.session.awaitingInput = null;
    await sendBuyConfirmNew(ctx);
    return;
  }

  if (awaiting === 'custom_sell_amount') {
    const amount = parseFloat(text.trim());
    const pos = ctx.session.positions[ctx.session.posIdx] as any;
    if (!pos) {
      ctx.session.awaitingInput = null;
      return;
    }
    const maxShares = BigInt(pos.shares);
    const sharesBigint = BigInt(Math.floor(amount * 1e6));
    if (isNaN(amount) || amount <= 0 || sharesBigint > maxShares) {
      const { fmtUsdc } = await import('./engine/trading.js');
      const msg = await ctx.reply(`❌ Invalid amount. Enter shares between 0 and ${roundShares(fmtUsdc(maxShares))}:`);
      ctx.session.lastBotMsgId = msg.message_id;
      return;
    }
    ctx.session.sellShares = sharesBigint.toString();
    ctx.session.awaitingInput = null;
    await sendSellConfirmNew(ctx);
    return;
  }

  if (awaiting === 'setting_value') {
    const settingKey = ctx.session.editingSetting;
    if (!settingKey) {
      ctx.session.awaitingInput = null;
      return;
    }
    const val = parseFloat(text.trim());
    if (isNaN(val) || val < 0) {
      const msg = await ctx.reply('❌ Invalid number. Try again:');
      ctx.session.lastBotMsgId = msg.message_id;
      return;
    }
    updateSetting(userId, settingKey, val);
    ctx.session.awaitingInput = null;
    ctx.session.editingSetting = null;
    const msg = await ctx.reply(`✅ *${getSettingLabel(settingKey)}* updated to *${val}*`, { parse_mode: 'Markdown' });
    ctx.session.lastBotMsgId = msg.message_id;
    // Show settings grid again as new message
    await showSettingsAsNew(ctx);
    return;
  }
});

// Helper to send buy confirmation as new message (after text input)
async function sendBuyConfirmNew(ctx: BotContext): Promise<void> {
  const market = ctx.session.market;
  const side = ctx.session.side;
  const amount = ctx.session.amount;
  if (!market || !side || !amount) return;

  const { quoteBuy, fmtUsdc } = await import('./engine/trading.js');
  const { getAddress, parseUnits } = await import('viem');
  const { USDC_DECIMALS } = await import('./engine/config.js');
  const { InlineKeyboard } = await import('grammy');

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
  const msgText =
    `📋 *Buy Confirmation*\n\n` +
    `Market: ${title}\n` +
    `Side: ${sideEmoji}\n` +
    `Amount: *${amount} USDC*\n` +
    `${quoteText}`;

  const kb = new InlineKeyboard()
    .text('✅ Confirm', 'bc')
    .text('❌ Cancel', 'm');

  await safeSend(ctx, msgText, { parse_mode: 'Markdown', reply_markup: kb });
}

async function sendSellConfirmNew(ctx: BotContext): Promise<void> {
  const pos = ctx.session.positions[ctx.session.posIdx] as any;
  if (!pos || !ctx.session.sellShares) return;

  const { quoteSell, fmtUsdc } = await import('./engine/trading.js');
  const { getAddress } = await import('viem');
  const { InlineKeyboard } = await import('grammy');

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
  const msgText =
    `📋 *Sell Confirmation*\n\n` +
    `Market: ${title}\n` +
    `Side: ${pos.side}\n` +
    `Shares: *${roundShares(fmtUsdc(shares))}*\n` +
    `${quoteText}`;

  const kb = new InlineKeyboard()
    .text('✅ Confirm', 'sc')
    .text('❌ Cancel', 'm');

  await safeSend(ctx, msgText, { parse_mode: 'Markdown', reply_markup: kb });
}

// Callback query handler — all button routing
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery();

  try {
    // Main menu
    if (data === 'm') {
      await sendMainMenu(ctx);
      return;
    }

    // Wallet setup
    if (data === 'sw') {
      ctx.session.awaitingInput = 'private_key';
      await safeEdit(ctx,
        '🔐 *Wallet Setup*\n\n⚠️ Send your private key. It will be encrypted and stored securely. The message will be deleted immediately.\n\nSend your private key (0x...):',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    // Markets
    if (data.startsWith('mk:')) {
      const page = parseInt(data.split(':')[1]);
      await showMarkets(ctx, page);
      return;
    }

    // Market detail
    if (data.startsWith('md:')) {
      const idx = parseInt(data.split(':')[1]);
      await showMarketDetail(ctx, idx);
      return;
    }

    // Buy side picker
    if (data === 'bs:pick') {
      await showBuySide(ctx);
      return;
    }

    // Buy side selected
    if (data === 'bs:y' || data === 'bs:n') {
      ctx.session.side = data === 'bs:y' ? 'YES' : 'NO';
      await showBuyAmount(ctx);
      return;
    }

    // Buy amount
    if (data.startsWith('ba:')) {
      const val = data.split(':')[1];
      if (val === 'custom') {
        ctx.session.awaitingInput = 'custom_buy_amount';
        await safeEdit(ctx, '💰 Enter custom USDC amount:');
        return;
      }
      ctx.session.amount = parseFloat(val);
      await showBuyConfirm(ctx);
      return;
    }

    // Buy confirm
    if (data === 'bc') {
      await executeBuy(ctx);
      return;
    }

    // Sell All positions (from main menu)
    if (data === 'sa:all_positions') {
      await showSellAllConfirm(ctx);
      return;
    }

    // Sell All confirm
    if (data === 'sa:confirm_all') {
      await executeSellAll(ctx);
      return;
    }

    // Sell list
    if (data === 'sl') {
      await showPositions(ctx);
      return;
    }

    // Sell position index
    if (data.startsWith('si:')) {
      const idx = parseInt(data.split(':')[1]);
      await showSellOptions(ctx, idx);
      return;
    }

    // Sell from market detail (current market)
    if (data === 'sp:this') {
      await showPositions(ctx);
      return;
    }

    // Sell amount
    if (data.startsWith('sa:')) {
      const val = data.split(':')[1];
      const pos = ctx.session.positions[ctx.session.posIdx] as any;
      if (!pos) return;
      const shares = BigInt(pos.shares);

      if (val === 'all') {
        ctx.session.sellShares = shares.toString();
      } else if (val === 'half') {
        ctx.session.sellShares = (shares / 2n).toString();
      } else if (val === 'custom') {
        ctx.session.awaitingInput = 'custom_sell_amount';
        const { fmtUsdc } = await import('./engine/trading.js');
        await safeEdit(ctx, `Enter shares to sell (max ${roundShares(fmtUsdc(shares))}):`);
        return;
      }
      await showSellConfirm(ctx);
      return;
    }

    // Sell confirm
    if (data === 'sc') {
      await executeSell(ctx);
      return;
    }

    // Balance
    if (data === 'bl') {
      await showBalance(ctx);
      return;
    }

    // Auto-trade
    if (data === 'at') {
      await showAutoTrade(ctx);
      return;
    }

    // Auto start
    if (data === 'as') {
      await startAutoTrade(ctx);
      return;
    }

    // Auto stop
    if (data === 'ax') {
      await stopAutoTrade(ctx);
      return;
    }

    // Trading mode toggle
    if (data.startsWith('tm:')) {
      const mode = data.split(':')[1]; // 'flip' or 'mixed'
      updateSetting(ctx.from!.id, 'mode', mode);
      await showAutoTrade(ctx);
      return;
    }

    // Settings
    if (data === 'ts') {
      await showSettings(ctx);
      return;
    }

    // Edit setting
    if (data.startsWith('te:')) {
      const key = data.split(':')[1];
      ctx.session.awaitingInput = 'setting_value';
      ctx.session.editingSetting = key;
      const label = getSettingLabel(key);
      const desc = getSettingDescription(key);
      const current = getSettingCurrentValue(ctx.from!.id, key);
      const text =
        `⚙️ *${label}*\n` +
        `${desc}\n` +
        `Current: *${current}*\n\n` +
        `Enter new value:`;
      await safeEdit(ctx, text, { parse_mode: 'Markdown' });
      return;
    }
  } catch (err: any) {
    console.error('Callback error:', err);
    const text = friendlyError(err);
    const kb = new (await import('grammy')).InlineKeyboard().text('🔙 Menu', 'm');
    try {
      await safeEdit(ctx, text, { reply_markup: kb });
    } catch { /* can't edit, ignore */ }
  }
});

// Error handler — prevent crashes
bot.catch((err) => {
  console.error('Bot error:', err.message ?? err);
});

// Set bot commands & menu button
bot.api.setMyCommands([
  { command: 'start', description: '🎯 Open Yoso Bot' },
]).catch(() => {});

bot.api.setChatMenuButton({
  menu_button: { type: 'commands' },
}).catch(() => {});

// Start
console.log('Starting Yoso Bot...');
bot.start();
