/**
 * SQLite table definitions for Bitcoin StockMem.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS raw_news (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    source      TEXT,
    title       TEXT    NOT NULL,
    body        TEXT,
    url         TEXT,
    asset       TEXT,
    fetched_at  TEXT    NOT NULL,
    UNIQUE(url)
);

CREATE TABLE IF NOT EXISTS raw_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id         INTEGER REFERENCES raw_news(id),
    date            TEXT    NOT NULL,
    asset           TEXT,
    event_group     TEXT    NOT NULL,
    event_type      TEXT    NOT NULL,
    time            TEXT,
    location        TEXT,
    entities        TEXT,
    industries      TEXT,
    description     TEXT    NOT NULL,
    extended_attrs  TEXT,
    embedding       BLOB,
    created_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS merged_events (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    date                 TEXT    NOT NULL,
    asset                TEXT,
    event_group          TEXT    NOT NULL,
    event_type           TEXT    NOT NULL,
    time                 TEXT,
    location             TEXT,
    entities             TEXT,
    industries           TEXT,
    description          TEXT    NOT NULL,
    extended_attrs       TEXT,
    embedding            BLOB,
    source_raw_event_ids TEXT,
    prev_event_id        INTEGER,
    chain_depth          INTEGER DEFAULT 0,
    delta_info           TEXT,
    created_at           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_vectors (
    date            TEXT    NOT NULL,
    asset           TEXT    NOT NULL,
    type_vector     TEXT    NOT NULL,
    group_vector    TEXT    NOT NULL,
    event_count     INTEGER NOT NULL,
    PRIMARY KEY (date, asset)
);

CREATE TABLE IF NOT EXISTS reflections (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    date             TEXT    NOT NULL,
    asset            TEXT    NOT NULL,
    window_start     TEXT    NOT NULL,
    window_end       TEXT    NOT NULL,
    price_direction  TEXT    NOT NULL,
    price_change_pct REAL,
    reason           TEXT    NOT NULL,
    key_events       TEXT    NOT NULL,
    source           TEXT    NOT NULL,
    created_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS predictions (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    date                     TEXT    NOT NULL,
    asset                    TEXT    NOT NULL,
    predicted_direction      TEXT    NOT NULL,
    actual_direction         TEXT,
    reason                   TEXT,
    reference_reflection_ids TEXT,
    created_at               TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_news_date      ON raw_news(date);
CREATE INDEX IF NOT EXISTS idx_raw_events_date     ON raw_events(date);
CREATE INDEX IF NOT EXISTS idx_merged_events_date  ON merged_events(date);
CREATE INDEX IF NOT EXISTS idx_reflections_date    ON reflections(date);
CREATE INDEX IF NOT EXISTS idx_predictions_date    ON predictions(date);
`;
