import axios from 'axios';

const BASE_URL = 'https://api.pokemontcg.io/v2';
const API_KEY = process.env.POKEMON_TCG_API_KEY;

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
  headers: API_KEY ? { 'X-Api-Key': API_KEY } : {},
});

const tcgDexClient = axios.create({
  baseURL: 'https://api.tcgdex.net/v2/en',
  timeout: 8_000,
});

export interface TCGCard {
  id: string;
  name: string;
  number: string;
  rarity: string;
  set: { id: string; name: string };
  images: { small: string; large: string };
  tcgplayer?: {
    prices?: {
      normal?: { low: number; mid: number; high: number; market: number };
      holofoil?: { low: number; mid: number; high: number; market: number };
      reverseHolofoil?: { low: number; mid: number; high: number; market: number };
    };
  };
}

export interface TCGSet {
  id: string;
  name: string;
  series: string;
  total: number;
  releaseDate: string;
}

// Fetch all cards for seeding (paginated)
export async function fetchAllCards(page = 1, pageSize = 250): Promise<TCGCard[]> {
  const { data } = await client.get('/cards', {
    params: { page, pageSize, orderBy: 'set.releaseDate' },
  });
  return data.data as TCGCard[];
}

// Search cards by name
export async function searchCards(name: string): Promise<TCGCard[]> {
  const safeName = name.replace(/["\\]/g, '').trim();
  if (!safeName) return [];

  const query = `name:"${safeName}"`;
  try {
    const { data } = await client.get('/cards', {
      params: { q: query, pageSize: 20 },
    });
    const exact = data.data as TCGCard[];
    if (exact.length > 0) return exact;

    const broadQuery = `name:${safeName.split(/\s+/)[0]}*`;
    const broad = await client.get('/cards', {
      params: { q: broadQuery, pageSize: 20 },
    });
    const broadMatches = broad.data.data as TCGCard[];
    if (broadMatches.length > 0) return broadMatches;

    return searchCardsViaTCGDex(safeName);
  } catch (error) {
    console.warn('[PokemonTCG] Primary search failed, falling back to TCGdex:', error);
    return searchCardsViaTCGDex(safeName);
  }
}

async function searchCardsViaTCGDex(name: string): Promise<TCGCard[]> {
  const { data } = await tcgDexClient.get('/cards', { params: { name } });
  const cards = (Array.isArray(data) ? data : []).slice(0, 20) as Array<{
    id: string;
    localId: string;
    name: string;
    image?: string;
  }>;

  return cards.map((card) => {
    const setId = card.id.split('-')[0] || 'unknown';
    const imageBase = card.image ?? '';
    return {
      id: card.id,
      name: card.name,
      number: card.localId,
      rarity: '',
      set: { id: setId, name: setId.toUpperCase() },
      images: {
        small: imageBase ? `${imageBase}/low.png` : '',
        large: imageBase ? `${imageBase}/high.png` : '',
      },
    };
  });
}

// Get single card
export async function getCard(cardId: string): Promise<TCGCard | null> {
  try {
    const { data } = await client.get(`/cards/${cardId}`);
    return data.data as TCGCard;
  } catch {
    return null;
  }
}

// Extract best price from TCGPlayer prices object
export function extractPrice(card: TCGCard): { low: number; mid: number; high: number; market: number } | null {
  const prices = card.tcgplayer?.prices;
  if (!prices) return null;
  const priceData = prices.holofoil ?? prices.normal ?? prices.reverseHolofoil;
  if (!priceData) return null;
  return {
    low: priceData.low ?? 0,
    mid: priceData.mid ?? 0,
    high: priceData.high ?? 0,
    market: priceData.market ?? 0,
  };
}
