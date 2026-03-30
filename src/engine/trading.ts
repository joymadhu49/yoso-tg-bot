import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  parseUnits,
  encodeAbiParameters,
  parseAbiParameters,
  decodeAbiParameters,
  concat,
  type Address,
  type Hex,
} from 'viem';

import { USDC_ADDRESS, USDC_DECIMALS } from './config.js';
import { getPublicClient, sendUserOperation } from './client.js';
import { erc20Abi, marketAbi, smartAccountAbi, CALC_BUY_SELECTOR, CALC_SELL_SELECTOR } from './contracts.js';
import { invalidateMarketCache, depositWatchCheck } from './api.js';

export function parseUsdc(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS);
}

export function fmtUsdc(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

export async function getUsdcBalance(address: Address): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
}

export async function getSharesBalance(token: Address, address: Address): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
}

async function rawCall(to: Address, data: Hex): Promise<Hex> {
  const client = getPublicClient();
  return client.call({ to, data }).then((r: any) => r.data as Hex);
}

export async function quoteBuy(market: Address, outcome: bigint, usdcAmount: bigint) {
  const params = encodeAbiParameters(
    parseAbiParameters('uint256, uint256'),
    [outcome, usdcAmount],
  );
  const data = concat([CALC_BUY_SELECTOR as Hex, params]) as Hex;
  const result = await rawCall(market, data);

  const [shares, fee, price] = decodeAbiParameters(
    parseAbiParameters('uint256, uint256, uint256'),
    result,
  );
  return { shares, fee, price };
}

export async function quoteSell(market: Address, outcome: bigint, shares: bigint) {
  const params = encodeAbiParameters(
    parseAbiParameters('uint256, uint256'),
    [outcome, shares],
  );
  const data = concat([CALC_SELL_SELECTOR as Hex, params]) as Hex;
  const result = await rawCall(market, data);

  const [usdcReturn, fee, price] = decodeAbiParameters(
    parseAbiParameters('uint256, uint256, uint256'),
    result,
  );
  return { usdcReturn, fee, price };
}

function buildExecuteBatchCalldata(args: {
  targets: Address[];
  values: bigint[];
  data: `0x${string}`[];
}): `0x${string}` {
  return encodeFunctionData({
    abi: smartAccountAbi,
    functionName: 'executeBatch',
    args: [args.targets, args.values, args.data],
  });
}

export async function buy(params: {
  privateKey: string;
  smartAccountAddress: Address;
  market: string;
  outcome: bigint;
  usdcAmount: bigint;
  slippageBps?: number;
}) {
  const market = getAddress(params.market);
  const slippageBps = BigInt(params.slippageBps ?? 200);

  // Get quote
  const q = await quoteBuy(market, params.outcome, params.usdcAmount);
  const minShares = (q.shares * (10_000n - slippageBps)) / 10_000n;

  // Build approve calldata
  const approveCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [market, params.usdcAmount],
  });

  // Build buy calldata
  const buyCalldata = encodeFunctionData({
    abi: marketAbi,
    functionName: 'buy',
    args: [Number(params.outcome), params.usdcAmount, minShares],
  });

  // Build executeBatch (approve + buy)
  const callData = buildExecuteBatchCalldata({
    targets: [USDC_ADDRESS, market],
    values: [0n, 0n],
    data: [approveCalldata, buyCalldata],
  });

  const result = await sendUserOperation(params.privateKey, params.smartAccountAddress, callData);

  // Cache invalidation (fire-and-forget)
  await invalidateMarketCache(market, params.smartAccountAddress).catch(() => undefined);

  return { quote: q, minShares, ...result };
}

export async function sell(params: {
  privateKey: string;
  smartAccountAddress: Address;
  market: string;
  outcome: bigint;
  shares: bigint;
  slippageBps?: number;
}) {
  const market = getAddress(params.market);
  const slippageBps = BigInt(params.slippageBps ?? 200);

  // Get quote
  const q = await quoteSell(market, params.outcome, params.shares);
  const minReturn = (q.usdcReturn * (10_000n - slippageBps)) / 10_000n;

  // Build sell calldata
  const sellCalldata = encodeFunctionData({
    abi: marketAbi,
    functionName: 'sell',
    args: [Number(params.outcome), params.shares, minReturn],
  });

  // Build executeBatch (sell)
  const callData = buildExecuteBatchCalldata({
    targets: [market],
    values: [0n],
    data: [sellCalldata],
  });

  const result = await sendUserOperation(params.privateKey, params.smartAccountAddress, callData);

  await invalidateMarketCache(market, params.smartAccountAddress).catch(() => undefined);
  await depositWatchCheck(params.smartAccountAddress).catch(() => undefined);

  return { quote: q, minReturn, ...result };
}
