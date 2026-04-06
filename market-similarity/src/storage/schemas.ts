export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS market_days (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    date          TEXT    NOT NULL UNIQUE,
    price         REAL    NOT NULL,
    arm           REAL    NOT NULL,
    srm           REAL    NOT NULL,
    factor_array  TEXT    NOT NULL,
    pct_change    REAL    NOT NULL,
    text_summary  TEXT    NOT NULL,
    hybrid_vector BLOB,
    num_dims      INTEGER NOT NULL,
    created_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_days_date ON market_days(date);

CREATE TABLE IF NOT EXISTS market_days_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;
