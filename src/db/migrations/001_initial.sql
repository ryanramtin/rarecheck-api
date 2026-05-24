-- CardSignal initial schema

-- Users (minimal — no PII beyond UUID)
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cards master catalog (seeded from Pokemon TCG API)
CREATE TABLE IF NOT EXISTS cards (
    id                  TEXT PRIMARY KEY,   -- e.g. "xy1-1"
    name                TEXT NOT NULL,
    set_name            TEXT NOT NULL,
    set_code            TEXT NOT NULL,
    collector_number    TEXT NOT NULL,
    rarity              TEXT NOT NULL DEFAULT '',
    image_url           TEXT NOT NULL DEFAULT '',
    image_url_hires     TEXT NOT NULL DEFAULT '',
    phash               BIGINT,             -- perceptual hash (nullable until computed)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cards_name ON cards USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_cards_set_code ON cards (set_code);
CREATE INDEX IF NOT EXISTS idx_cards_collector ON cards (set_code, collector_number);

-- Price cache (refreshed every 6 hours via cron)
CREATE TABLE IF NOT EXISTS price_cache (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    price_low   NUMERIC(10,2),
    price_mid   NUMERIC(10,2),
    price_high  NUMERIC(10,2),
    price_market NUMERIC(10,2),
    currency    TEXT NOT NULL DEFAULT 'USD',
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (card_id)
);

CREATE INDEX IF NOT EXISTS idx_price_cache_card_id ON price_cache (card_id);
CREATE INDEX IF NOT EXISTS idx_price_cache_fetched ON price_cache (fetched_at);

-- Price history (daily snapshots for 30-day chart)
CREATE TABLE IF NOT EXISTS price_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    price_market NUMERIC(10,2) NOT NULL,
    recorded_date DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (card_id, recorded_date)
);

CREATE INDEX IF NOT EXISTS idx_price_history_card_date ON price_history (card_id, recorded_date DESC);

-- User collections (IDOR: always filter by user_id)
CREATE TABLE IF NOT EXISTS collection_cards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id         TEXT NOT NULL REFERENCES cards(id),
    notes           TEXT,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_user ON collection_cards (user_id);

-- Audit log (SOC 2)
CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID,               -- nullable for unauthenticated requests
    action      TEXT NOT NULL,      -- e.g. 'cards.identify', 'collection.save'
    resource_id TEXT,
    ip          INET,
    user_agent  TEXT,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action);
