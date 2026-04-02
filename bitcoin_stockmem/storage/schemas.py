"""SQLite table definitions for Bitcoin StockMem."""

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS raw_news (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,               -- YYYY-MM-DD
    source      TEXT,                           -- "cryptopanic", "coindesk", etc.
    title       TEXT    NOT NULL,
    body        TEXT,
    url         TEXT,
    asset       TEXT,                           -- "BTC", "ETH", or "ALL"
    fetched_at  TEXT    NOT NULL,
    UNIQUE(url)
);

CREATE TABLE IF NOT EXISTS raw_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id         INTEGER REFERENCES raw_news(id),
    date            TEXT    NOT NULL,
    asset           TEXT,                       -- "BTC", "ETH", or "ALL"
    event_group     TEXT    NOT NULL,
    event_type      TEXT    NOT NULL,
    time            TEXT,
    location        TEXT,
    entities        TEXT,                       -- JSON array
    industries      TEXT,                       -- JSON array
    description     TEXT    NOT NULL,           -- summarised text for embedding
    extended_attrs  TEXT,                       -- JSON object
    embedding       BLOB,                      -- numpy bytes
    created_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS merged_events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    date                TEXT    NOT NULL,
    asset               TEXT,
    event_group         TEXT    NOT NULL,
    event_type          TEXT    NOT NULL,
    time                TEXT,
    location            TEXT,
    entities            TEXT,
    industries          TEXT,
    description         TEXT    NOT NULL,
    extended_attrs      TEXT,
    embedding           BLOB,
    source_raw_event_ids TEXT,                  -- JSON array of raw_event ids
    prev_event_id       INTEGER,               -- predecessor in event chain
    chain_depth         INTEGER DEFAULT 0,
    delta_info          TEXT,                   -- incremental information
    created_at          TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_vectors (
    date            TEXT    NOT NULL,
    asset           TEXT    NOT NULL,
    type_vector     TEXT    NOT NULL,           -- JSON array of 0/1, length M
    group_vector    TEXT    NOT NULL,           -- JSON array of 0/1, length G
    event_count     INTEGER NOT NULL,
    PRIMARY KEY (date, asset)
);

CREATE TABLE IF NOT EXISTS reflections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT    NOT NULL,           -- window end date
    asset           TEXT    NOT NULL,
    window_start    TEXT    NOT NULL,
    window_end      TEXT    NOT NULL,
    price_direction TEXT    NOT NULL,           -- "up" / "down"
    price_change_pct REAL,
    reason          TEXT    NOT NULL,           -- LLM causal explanation
    key_events      TEXT    NOT NULL,           -- JSON list
    source          TEXT    NOT NULL,           -- "train" or "online"
    created_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS predictions (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    date                    TEXT    NOT NULL,   -- prediction target date (t+1)
    asset                   TEXT    NOT NULL,
    predicted_direction     TEXT    NOT NULL,   -- "up" / "down"
    actual_direction        TEXT,               -- filled after truth known
    reason                  TEXT,
    reference_reflection_ids TEXT,              -- JSON array
    created_at              TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_news_date      ON raw_news(date);
CREATE INDEX IF NOT EXISTS idx_raw_events_date     ON raw_events(date);
CREATE INDEX IF NOT EXISTS idx_merged_events_date  ON merged_events(date);
CREATE INDEX IF NOT EXISTS idx_reflections_date    ON reflections(date);
CREATE INDEX IF NOT EXISTS idx_predictions_date    ON predictions(date);
"""
