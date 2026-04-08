export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS daily_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    asset       TEXT    NOT NULL,
    json_data   TEXT    NOT NULL,
    joint_vec   TEXT    NOT NULL,
    UNIQUE(date, asset)
);
CREATE INDEX IF NOT EXISTS idx_daily_records_date ON daily_records(date);
`;
