import cron from 'node-cron';
import { db } from '../db/client.js';
import { getCard, extractPrice } from '../services/pokemonTCGService.js';

// Refresh prices for all cached cards every 6 hours
// Runs at minute 0, every 6 hours: 0,6,12,18:00

export function startPriceCacheJob() {
  cron.schedule('0 */6 * * *', async () => {
    console.log('[PriceCacheJob] Starting price refresh...');
    const start = Date.now();

    try {
      // Get all cards that have cached prices (stale > 6h or never refreshed)
      const ttlHours = Number(process.env.PRICE_CACHE_TTL_HOURS) || 6;
      const staleCutoff = new Date(Date.now() - ttlHours * 3_600_000);

      const stale = await db.query<{ id: string }>(
        `SELECT c.id FROM cards c
         LEFT JOIN price_cache pc ON pc.card_id = c.id
         WHERE pc.fetched_at IS NULL OR pc.fetched_at < $1
         LIMIT 500`,
        [staleCutoff]
      );

      console.log(`[PriceCacheJob] Refreshing ${stale.rows.length} stale cards`);

      let refreshed = 0;
      let failed = 0;

      for (const { id } of stale.rows) {
        try {
          const card = await getCard(id);
          const price = card ? extractPrice(card) : null;
          if (!price) { failed++; continue; }

          await db.query(
            `INSERT INTO price_cache (card_id, price_low, price_mid, price_high, price_market, fetched_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (card_id) DO UPDATE SET
               price_low = EXCLUDED.price_low,
               price_mid = EXCLUDED.price_mid,
               price_high = EXCLUDED.price_high,
               price_market = EXCLUDED.price_market,
               fetched_at = NOW()`,
            [id, price.low, price.mid, price.high, price.market]
          );

          // Daily snapshot
          await db.query(
            `INSERT INTO price_history (card_id, price_market, recorded_date)
             VALUES ($1, $2, CURRENT_DATE)
             ON CONFLICT (card_id, recorded_date) DO UPDATE SET price_market = EXCLUDED.price_market`,
            [id, price.market]
          );

          refreshed++;
          // Rate-limit-friendly delay between API calls
          await sleep(200);
        } catch {
          failed++;
        }
      }

      const elapsed = Date.now() - start;
      console.log(`[PriceCacheJob] Done in ${elapsed}ms — refreshed: ${refreshed}, failed: ${failed}`);
    } catch (err) {
      console.error('[PriceCacheJob] Job failed:', err);
    }
  });

  console.log('[PriceCacheJob] Scheduled (every 6 hours)');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
