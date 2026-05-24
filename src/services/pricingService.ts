import { db } from '../db/client.js';
import { getCard, extractPrice } from './pokemonTCGService.js';

export interface PriceHistoryPoint {
  date: string;   // "YYYY-MM-DD"
  market: number;
}

// Get current price, refreshing if stale
export async function getCurrentPrice(cardId: string) {
  const result = await db.query<{
    price_low: number; price_mid: number; price_high: number;
    price_market: number; fetched_at: Date;
  }>(
    `SELECT price_low, price_mid, price_high, price_market, fetched_at
     FROM price_cache WHERE card_id = $1`,
    [cardId]
  );

  const ttlHours = Number(process.env.PRICE_CACHE_TTL_HOURS) || 6;
  const row = result.rows[0];
  const isStale = !row || Date.now() - row.fetched_at.getTime() > ttlHours * 3_600_000;

  if (isStale) {
    return await refreshPrice(cardId);
  }

  return {
    low: Number(row.price_low),
    mid: Number(row.price_mid),
    high: Number(row.price_high),
    market: Number(row.price_market),
    currency: 'USD',
    updatedAt: row.fetched_at.toISOString(),
  };
}

// Refresh price from Pokemon TCG API and persist a history snapshot
export async function refreshPrice(cardId: string) {
  const card = await getCard(cardId);
  const price = card ? extractPrice(card) : null;

  if (!price) return null;

  await db.query(
    `INSERT INTO price_cache (card_id, price_low, price_mid, price_high, price_market, fetched_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (card_id) DO UPDATE SET
       price_low = EXCLUDED.price_low,
       price_mid = EXCLUDED.price_mid,
       price_high = EXCLUDED.price_high,
       price_market = EXCLUDED.price_market,
       fetched_at = NOW()`,
    [cardId, price.low, price.mid, price.high, price.market]
  );

  // Write daily snapshot
  await db.query(
    `INSERT INTO price_history (card_id, price_market, recorded_date)
     VALUES ($1, $2, CURRENT_DATE)
     ON CONFLICT (card_id, recorded_date) DO UPDATE SET price_market = EXCLUDED.price_market`,
    [cardId, price.market]
  );

  return { ...price, currency: 'USD', updatedAt: new Date().toISOString() };
}

// Fetch 30-day price history
export async function getPriceHistory(cardId: string): Promise<PriceHistoryPoint[]> {
  const result = await db.query<{ recorded_date: Date; price_market: number }>(
    `SELECT recorded_date, price_market
     FROM price_history
     WHERE card_id = $1
       AND recorded_date >= CURRENT_DATE - INTERVAL '30 days'
     ORDER BY recorded_date ASC`,
    [cardId]
  );

  return result.rows.map((row) => ({
    date: row.recorded_date.toISOString().split('T')[0],
    market: Number(row.price_market),
  }));
}
