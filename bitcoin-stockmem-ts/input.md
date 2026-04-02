# Input Data - Bitcoin StockMem

## 3 nguon Input Data

### 1. Tin tuc Crypto (`src/data/news-fetcher.ts`)

**Nguon chinh — CryptoPanic Developer API v2:**
- URL: `cryptopanic.com/api/developer/v2/posts/`
- Filter: `currencies=BTC,ETH`, `kind=news`
- Tra ve: title, body (`content.clean`), URL, source, published_at, instruments
- Phan loai asset: dua vao `instruments` -> BTC, ETH, hoac ALL
- Pagination toi da 20 trang, rate limit 600ms/request

**Nguon fallback — RSS feeds:**
- CoinDesk (`coindesk.com/arc/outboundfeeds/rss/`)
- CoinTelegraph (`cointelegraph.com/rss`)
- The Block (`theblock.co/rss.xml`)
- Phan loai asset: dua vao keyword trong title (BITCOIN/BTC -> BTC, ETHEREUM/ETH -> ETH)
- Body lay tu `contentSnippet`

**Ket hop:** Chay song song ca 2 nguon -> deduplicate theo URL -> sort theo date.

**Cau truc `NewsArticle`:**
```ts
{
  date: string;      // "2025-03-15"
  title: string;     // "SEC Approves Bitcoin ETF..."
  url: string;
  source: string;    // "CoinDesk", "cryptopanic"...
  asset: string;     // "BTC" | "ETH" | "ALL"
  body: string|null; // Noi dung bai viet
}
```

---

### 2. Du lieu gia (`src/data/price-fetcher.ts`)

- **Nguon:** Binance qua thu vien `ccxt`
- **Cap giao dich:** BTC/USDT, ETH/USDT
- **Loai du lieu:** OHLCV daily (1d candle)
- **Tinh toan them:** `return_pct` = (close_today - close_yesterday) / close_yesterday

**Cau truc `PriceRow`:**
```ts
{
  date: string;          // "2025-03-15"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  return_pct: number;    // % thay doi so hom qua
}
```

---

### 3. Taxonomy su kien (`src/data/taxonomy.ts`)

13 groups, 56 event types — da adapt cho crypto (paper goc dung cho stock):

| Group | Event Types |
|-------|-------------|
| **Regulation & Legal** | Regulatory Announcement, Enforcement Action, Legislation Progress, Government Stance, International Sanctions or Bans |
| **Macroeconomic** | Interest Rate Decision, Inflation Data, Dollar Index Movement, QE/QT |
| **Industry Standards & Opinions** | Protocol Proposal, Industry Report, Analyst/Influencer Opinion |
| **Protocol & Product** | Protocol Upgrade, New Feature Launch, Testnet/Mainnet Launch, Adoption Metric, Fee/Gas Change, Hash Rate Change, Supply Dynamics |
| **Technology & Development** | Technical Breakthrough, Dev Milestone, Audit, Node/Validator Update, Ecosystem Integration, Developer Tooling |
| **Exchange & Trading** | Listing/Delisting, Funding Round, Revenue Report, Acquisition, Partnership, Custody, Liquidation, Reserve Proof |
| **DeFi & Ecosystem** | Protocol Launch, Protocol Migration, Cross-chain Expansion |
| **Whale & On-chain** | Whale Accumulation/Distribution, On-chain Flow Anomaly, Miner Selling |
| **Key Figures** | Executive Appointment, Founder Statement, Legal Action |
| **Market Performance** | Market Cap Milestone, Sector Rotation, BTC Dominance, Volume Surge, ETF Flow, Institutional View |
| **TradFi Crossover** | Stock/Bond/Commodity Correlation, Stablecoin Flow |
| **Partnership & Adoption** | Strategic Partnership, Payment Integration, Institutional Adoption, Alliance |
| **Risk & Warning** | Security Breach/Hack, Rug Pull/Scam, Regulatory Risk, Systemic Risk, Exchange Insolvency |

Taxonomy dung de:
- Prompt LLM phan loai su kien (Step 1)
- Tao binary vectors cho Jaccard similarity (Step 5)

---

### Label generation (`src/data/label-generator.ts`)

Tu price data -> tao label cho training:
- `return > +1%` -> **"up"**
- `return < -1%` -> **"down"**
- Trong khoang +/-1% -> **"flat"** (bi loc ra, khong dung)

---

## Hyperparameters (`src/config.ts`, khop paper)

| Param | Gia tri | Y nghia |
|-------|---------|---------|
| `WINDOW_SIZE` | 5 | Cua so w ngay cho event series |
| `ALPHA` | 0.7 | Trong so type vs group trong DailySim |
| `D_MAX` | 5 | Do sau toi da event chain |
| `TOP_K_TRACK` | 10 | Top-K candidates cho event tracking |
| `TOP_K_RETRIEVE` | 10 | Top-K sequences cho retrieval |
| `PRICE_THRESHOLD` | 0.01 | +/-1% nguong phan loai up/down |
| `CLUSTER_DISTANCE_THRESHOLD` | 0.3 | Nguong cosine distance cho clustering |

---

## DB Schema (SQLite) — 6 bang (`src/storage/schemas.ts`)

| Bang | Muc dich |
|------|----------|
| `raw_news` | Tin tuc goc |
| `raw_events` | Su kien trich xuat (Step 1) |
| `merged_events` | Su kien da gop + tracking info: `prev_event_id`, `chain_depth`, `delta_info` (Step 2-3) |
| `daily_vectors` | Binary vectors type/group cho Jaccard (Step 5) |
| `reflections` | Reflection memory: reason + key_events (Step 4) |
| `predictions` | Ket qua du doan + actual direction (Step 6) |
