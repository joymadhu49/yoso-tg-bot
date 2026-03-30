import { getAddress } from 'viem';

export const CHAIN_ID = 8453;

export const YOSO_BASE_URL = process.env.YOSO_BASE_URL ?? 'https://yoso.fun';

export const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY ?? 'EOPPpPlCA-iI-DvSp7S78';
export const ALCHEMY_RPC_URL = `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

export const ALCHEMY_POLICY_ID = process.env.ALCHEMY_POLICY_ID ?? '74bf9902-e969-449e-86bd-f567ea7c51f2';

export const USDC_ADDRESS = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
export const ENTRYPOINT_V07 = getAddress('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
export const PAYMASTER_ADDRESS = getAddress('0x2cc0c7981D846b9F2a16276556f6e8cb52BfB633');

export const USDC_DECIMALS = 6;

export const OUTCOME = {
  YES: 1n,
  NO: 2n,
} as const;

export type OutcomeSide = keyof typeof OUTCOME;

export function parseOutcomeSide(side: string): 1n | 2n {
  const s = side.toUpperCase();
  if (s === 'YES') return OUTCOME.YES;
  if (s === 'NO') return OUTCOME.NO;
  throw new Error(`Invalid side: ${side} (expected YES or NO)`);
}
