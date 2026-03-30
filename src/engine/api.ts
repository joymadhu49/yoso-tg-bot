import { YOSO_BASE_URL } from './config.js';

export type MarketListItem = {
  address: string;
  title?: string;
  description?: string;
  state?: string;
  yesPrice?: number;
  noPrice?: number;
  yesToken?: string;
  noToken?: string;
  volume24h?: number;
  volume?: number;
};

export type MarketDetails = {
  address: string;
  title: string;
  description?: string;
  yesToken: string;
  noToken: string;
  yesPrice?: number;
  noPrice?: number;
  state?: string;
  [k: string]: unknown;
};

async function httpReq<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${YOSO_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function listMarkets(args?: {
  page?: number;
  limit?: number;
  state?: string;
  sort?: string;
  viewer?: string;
}): Promise<any> {
  const page = args?.page ?? 1;
  const limit = args?.limit ?? 24;
  const state = args?.state ?? 'TRADING';
  const sort = args?.sort ?? 'trending';
  const viewer = args?.viewer;

  const qs = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    state,
    sort,
    sortOrder: 'desc',
    category: 'explore',
  });
  if (viewer) qs.set('viewer', viewer);

  return httpReq(`/api/markets?${qs.toString()}`);
}

export async function getMarket(address: string): Promise<any> {
  return httpReq(`/api/markets/${address}`);
}

export async function getMarketPrice(address: string): Promise<any> {
  return httpReq(`/api/markets/${address}/price`);
}

export async function getUser(smartAccount: string): Promise<any> {
  return httpReq(`/api/users/${smartAccount}`);
}

export async function invalidateMarketCache(marketAddress: string, userAddress: string): Promise<any> {
  return httpReq(`/api/markets/${marketAddress}/invalidate`, {
    method: 'POST',
    body: JSON.stringify({ userAddress }),
  });
}

export async function depositWatchCheck(userAddress: string): Promise<any> {
  return httpReq(`/api/deposit-watch/check`, {
    method: 'POST',
    body: JSON.stringify({ userAddress }),
  });
}
