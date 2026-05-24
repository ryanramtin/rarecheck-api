import { db } from '../db/client.js';
import { searchCards, extractPrice } from './pokemonTCGService.js';

export interface CardMatchResult {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  imageUrl: string;
  confidence: number;
  price: {
    low: number;
    mid: number;
    high: number;
    market: number;
    currency: string;
    updatedAt: string;
  };
}

interface DBCard {
  id: string;
  name: string;
  set_name: string;
  set_code: string;
  collector_number: string;
  rarity: string;
  image_url: string;
  phash: bigint | null;
}

interface DBPrice {
  price_low: number;
  price_mid: number;
  price_high: number;
  price_market: number;
  fetched_at: Date;
}

// MARK: - Main Identification Entry Point

export async function identifyCard(imageBase64: string): Promise<CardMatchResult[]> {
  // Step 1: Decode and parse text hints from image metadata / heuristics
  // (Full pHash computation would happen server-side with sharp; here we use
  //  text-based fuzzy search as the primary backend strategy)
  const textHints = await extractTextHints(imageBase64);

  // Step 2: Search database using full-text search on card names
  const dbResults = await searchDatabase(textHints);

  if (dbResults.length > 0) return dbResults;

  // Step 3: Fall back to live Pokemon TCG API search
  return await searchViaTCGAPI(textHints);
}

// MARK: - Database Search (full-text + collector number match)

async function searchDatabase(hints: { name?: string; collectorNumber?: string; setCode?: string }): Promise<CardMatchResult[]> {
  if (!hints.name && !hints.collectorNumber) return [];

  let query = `
    SELECT c.*, pc.price_low, pc.price_mid, pc.price_high, pc.price_market, pc.fetched_at,
           ts_rank(to_tsvector('english', c.name), plainto_tsquery('english', $1)) as rank
    FROM cards c
    LEFT JOIN price_cache pc ON pc.card_id = c.id
  `;
  const params: (string | null)[] = [hints.name ?? ''];
  const conditions: string[] = [];

  if (hints.name) {
    conditions.push(`to_tsvector('english', c.name) @@ plainto_tsquery('english', $1)`);
  }
  if (hints.setCode) {
    params.push(hints.setCode);
    conditions.push(`c.set_code = $${params.length}`);
  }
  if (hints.collectorNumber) {
    params.push(hints.collectorNumber);
    conditions.push(`c.collector_number = $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }
  query += ` ORDER BY rank DESC LIMIT 3`;

  const result = await db.query<DBCard & DBPrice & { rank: number }>(query, params);
  return result.rows.map((row) => rowToMatch(row));
}

// MARK: - TCG API Fallback

async function searchViaTCGAPI(hints: { name?: string }): Promise<CardMatchResult[]> {
  if (!hints.name) return [];

  const cards = await searchCards(hints.name);
  const matches: CardMatchResult[] = [];

  for (const card of cards.slice(0, 3)) {
    // Upsert into local DB for future cache hits
    const price = extractPrice(card);
    await upsertCard(card, price);

    matches.push({
      id: card.id,
      name: card.name,
      setName: card.set.name,
      setCode: card.set.id,
      collectorNumber: card.number,
      rarity: card.rarity ?? '',
      imageUrl: card.images.large ?? card.images.small,
      confidence: 0.6,  // lower confidence for text-only API match
      price: {
        low: price?.low ?? 0,
        mid: price?.mid ?? 0,
        high: price?.high ?? 0,
        market: price?.market ?? 0,
        currency: 'USD',
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return matches;
}

// MARK: - Image Text Extraction (heuristic for backend)
// The iOS client already runs Vision OCR — we expect the JSON body to include
// textHints. If the client is old/missing them, we return empty hints.

async function extractTextHints(_imageBase64: string): Promise<{ name?: string; collectorNumber?: string; setCode?: string }> {
  // Real implementation: use Tesseract or a Vision API here
  // For now, the client sends pre-extracted OCR hints in the request body
  return {};
}

// MARK: - Upsert

async function upsertCard(
  card: { id: string; name: string; set: { id: string; name: string }; number: string; rarity: string; images: { large: string; small: string } },
  price: { low: number; mid: number; high: number; market: number } | null
): Promise<void> {
  await db.query(
    `INSERT INTO cards (id, name, set_name, set_code, collector_number, rarity, image_url, image_url_hires)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       image_url = EXCLUDED.image_url,
       updated_at = NOW()`,
    [card.id, card.name, card.set.name, card.set.id, card.number, card.rarity ?? '', card.images.small, card.images.large ?? '']
  );

  if (price) {
    await db.query(
      `INSERT INTO price_cache (card_id, price_low, price_mid, price_high, price_market, fetched_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (card_id) DO UPDATE SET
         price_low = EXCLUDED.price_low,
         price_mid = EXCLUDED.price_mid,
         price_high = EXCLUDED.price_high,
         price_market = EXCLUDED.price_market,
         fetched_at = NOW()`,
      [card.id, price.low, price.mid, price.high, price.market]
    );
  }
}

// MARK: - Row Mapper

function rowToMatch(row: DBCard & Partial<DBPrice> & { rank?: number }): CardMatchResult {
  const confidence = Math.min(0.5 + (row.rank ?? 0) * 0.1, 1.0);
  return {
    id: row.id,
    name: row.name,
    setName: row.set_name,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    imageUrl: row.image_url,
    confidence,
    price: {
      low: Number(row.price_low ?? 0),
      mid: Number(row.price_mid ?? 0),
      high: Number(row.price_high ?? 0),
      market: Number(row.price_market ?? 0),
      currency: 'USD',
      updatedAt: row.fetched_at?.toISOString() ?? new Date().toISOString(),
    },
  };
}
