# Input — Dữ liệu đầu vào chi tiết

## Tổng quan

Hệ thống nhận đầu vào là dữ liệu giao dịch BTC theo ngày, dưới dạng JSON. Mỗi ngày giao dịch được biểu diễn bằng 1 object `DailyJsonInput`.

Có 2 chế độ input:

| Chế độ | Body | Mô tả |
|--------|------|-------|
| **Tìm 1 ngày** | 1 JSON object `{...}` | Tìm các ngày đơn lẻ có pattern giống nhất |
| **Chuỗi 5 ngày** | 1 JSON array `[{...}, {...}, {...}, {...}, {...}]` | Tìm chuỗi 5 ngày liên tiếp có pattern giống nhất |

---

## Schema: `DailyJsonInput`

```typescript
interface DailyJsonInput {
  date: string;                // "2024-01-15"
  asset: string;               // "BTC"
  msi: number;                 // 62.5
  rsi: number;                 // 58.3
  sentiment_score_avg: number; // 0.72
  text: string;                // "Bitcoin rallies on ETF optimism..."
  factors: string[];           // ["Record ETF inflows", "Fed holds interest rate steady"]
  fear_greed_index: number;    // 71
  price: number;               // 42850.00
  price_change_pct: number;    // 3.25
}
```

---

## Chi tiết từng field

### `date` — Ngày giao dịch

- **Kiểu**: `string`
- **Format**: `YYYY-MM-DD`
- **Ví dụ**: `"2024-01-15"`
- **Vai trò trong xử lý**: Dùng để **temporal exclusion** trong window search — candidate window phải nằm trước query window để tránh data leakage. Không tham gia vào vectorization.

### `asset` — Loại tài sản

- **Kiểu**: `string`
- **Giá trị**: `"BTC"` (hiện tại chỉ hỗ trợ Bitcoin)
- **Ví dụ**: `"BTC"`
- **Vai trò trong xử lý**: Metadata, không tham gia vectorization. Dùng để lọc và hiển thị.

### `msi` — Market Strength Index

- **Kiểu**: `number`
- **Phạm vi**: 0 - 100
- **Ví dụ**: `62.5`
- **Ý nghĩa**: Chỉ số sức mạnh thị trường tổng hợp. Giá trị cao = thị trường mạnh, giá trị thấp = thị trường yếu.
- **Vai trò trong xử lý**: Là 1 trong 5 numerical indicators → z-score normalize → scale α=0.5 → nằm trong joint vector.
- **Ref**: History Rhymes (Khanna, 2024) — numerical indicators concat vào joint vector.

### `rsi` — Relative Strength Index

- **Kiểu**: `number`
- **Phạm vi**: 0 - 100
- **Ví dụ**: `58.3`
- **Ý nghĩa**: Technical indicator đo momentum. RSI > 70 = overbought, RSI < 30 = oversold.
- **Vai trò trong xử lý**: Numerical indicator thứ 2/5 trong joint vector.
- **Ref**: History Rhymes — numerical indicators.

### `sentiment_score_avg` — Trung bình Sentiment Score

- **Kiểu**: `number`
- **Phạm vi**: -1.0 đến 1.0
- **Ví dụ**: `0.72` (tích cực), `-0.45` (tiêu cực), `0.05` (trung tính)
- **Ý nghĩa**: Trung bình sentiment từ các nguồn tin tức/mạng xã hội trong ngày. Giá trị dương = tích cực, giá trị âm = tiêu cực.
- **Vai trò trong xử lý**: Numerical indicator thứ 3/5 trong joint vector.
- **Ref**: History Rhymes — numerical indicators.

### `text` — Tóm tắt thị trường

- **Kiểu**: `string`
- **Ví dụ**: `"Bitcoin rallies on ETF optimism, whale accumulation continues"`
- **Ý nghĩa**: Mô tả ngắn gọn tình hình thị trường trong ngày.
- **Vai trò trong xử lý**: **Không tham gia vectorization**. Chỉ lưu trữ để hiển thị trong search results, giúp người dùng hiểu context.

### `factors` — Danh sách sự kiện/yếu tố ảnh hưởng

- **Kiểu**: `string[]`
- **Ví dụ**:
  ```json
  [
    "Record ETF inflows",
    "Fed holds interest rate steady",
    "Strong whale accumulation"
  ]
  ```
- **Ý nghĩa**: Các sự kiện thị trường xảy ra trong ngày — đây là field **quan trọng nhất** vì nó tạo ra 75 dimensions (62 typeVec + 13 groupVec) trong tổng 80 dimensions của joint vector.
- **Vai trò trong xử lý**: Mỗi factor string được map sang event type → tạo binary typeVec (62d) + groupVec (13d).
- **Ref**: StockMem (arXiv:2512.02720) Section 3.3, Formulas (3)-(4), Appendix A.

#### Yêu cầu quan trọng: Factor strings phải match chính xác

Factor strings **phải match chính xác** với 99 factors đã định nghĩa trong `FACTOR_TYPE_MAP` (`src/taxonomy.ts`). Nếu factor string không match, nó sẽ bị **bỏ qua hoàn toàn** (không tạo bit nào trong vector).

**Danh sách 99 factors hợp lệ:**

<details>
<summary><b>39 factors tăng giá (bullish)</b> (nhấn để mở)</summary>

| Factor | → Loại sự kiện | → Nhóm |
|--------|-------------|---------|
| SEC reviewing new ETF approval | Regulatory Announcement | Regulation & Legal |
| Strong whale accumulation | Whale Accumulation | Whale & On-chain |
| CPI lower than expected | Inflation Data | Macroeconomic |
| Fed holds interest rate steady | Interest Rate Decision | Macroeconomic |
| BlackRock increases BTC holdings | Institutional Adoption | Partnership & Adoption |
| Major corporation accepts BTC payments | Payment Integration | Partnership & Adoption |
| Hash rate hits new all-time high | Hash Rate Change | Protocol & Product |
| Institutional adoption increasing | Institutional Adoption | Partnership & Adoption |
| Record ETF inflows | ETF Flow | Market Performance |
| Gold positively correlated with BTC | Commodity Correlation | TradFi Crossover |
| Stablecoin inflows to exchanges rising | Stablecoin Flow | TradFi Crossover |
| Partnership with major bank | Strategic Partnership | Partnership & Adoption |
| Successful protocol upgrade | Protocol Upgrade | Protocol & Product |
| Significant volume surge | Volume Surge | Market Performance |
| Developer activity surging | Development Milestone | Technology & Development |
| Positive on-chain metrics | On-chain Flow Anomaly | Whale & On-chain |
| Supply decreasing due to halving effect | Supply Dynamics | Protocol & Product |
| DXY dollar index declining | Dollar Index Movement | Macroeconomic |
| BTC dominance rising | BTC Dominance Shift | Market Performance |
| New payment integration | Payment Integration | Partnership & Adoption |
| Grayscale GBTC premium rising | ETF Flow | Market Performance |
| MicroStrategy buys more BTC | Institutional Adoption | Partnership & Adoption |
| El Salvador increases BTC reserves | Government Stance | Regulation & Legal |
| Lightning Network adoption growing | Adoption Metric Change | Protocol & Product |
| DeFi TVL on Bitcoin rising | Protocol Launch | DeFi & Ecosystem |
| Fidelity opens BTC custody service | Custody Agreement | Exchange & Trading |
| JP Morgan positive outlook on BTC | Analyst or Influencer Opinion | Industry Standards & Opinions |
| Hash rate recovering after sell-off | Hash Rate Change | Protocol & Product |
| Binance Proof of Reserve stable | Reserve Proof | Exchange & Trading |
| Bitcoin spot volume hits record | Volume Surge | Market Performance |
| Mining difficulty adjustment decreasing | Hash Rate Change | Protocol & Product |
| Central bank record gold buying - bullish for BTC | Commodity Correlation | TradFi Crossover |
| Nasdaq positively correlated with crypto | Stock Correlation | TradFi Crossover |
| New Layer 2 scaling solution | Technical Breakthrough | Technology & Development |
| Fed pivot signal - market expects rate cut | Interest Rate Decision | Macroeconomic |
| US Treasury yield falling - capital flows to risk assets | Bond Signal | TradFi Crossover |
| Ordinals and BRC-20 adoption growing | Adoption Metric Change | Protocol & Product |
| Bitcoin ETF options approved | Regulatory Announcement | Regulation & Legal |
| Tether minting USDT - liquidity flowing in | Stablecoin Flow | TradFi Crossover |
| Coinbase revenue beats expectations | Revenue Report | Exchange & Trading |

</details>

<details>
<summary><b>40 factors giảm giá (bearish)</b> (nhấn để mở)</summary>

| Factor | → Loại sự kiện | → Nhóm |
|--------|-------------|---------|
| SEC rejects new ETF | Enforcement Action | Regulation & Legal |
| Strong whale selling | Whale Distribution | Whale & On-chain |
| CPI higher than expected | Inflation Data | Macroeconomic |
| Fed raises interest rate | Interest Rate Decision | Macroeconomic |
| Regulatory concerns from China | Government Stance | Regulation & Legal |
| Major exchange hack | Security Breach or Hack | Risk & Warning |
| Miner selling pressure increasing | Miner Selling | Whale & On-chain |
| Large market liquidations | Liquidation Event | Exchange & Trading |
| Significant ETF outflows | ETF Flow | Market Performance |
| Stablecoin outflows from exchanges | Stablecoin Flow | TradFi Crossover |
| Regulatory risk from EU | Regulatory Risk | Risk & Warning |
| Exchange insolvency concerns | Exchange Insolvency | Risk & Warning |
| Extreme greed index - correction risk | Institutional View | Market Performance |
| Dollar index surging | Dollar Index Movement | Macroeconomic |
| Bond yield rising - risk for crypto | Bond Signal | TradFi Crossover |
| Volume declining - liquidity drying up | Volume Surge | Market Performance |
| BTC dominance declining | BTC Dominance Shift | Market Performance |
| Systemic risk concerns | Systemic Risk | Risk & Warning |
| Major project rug pull | Rug Pull or Scam | Risk & Warning |
| Legal action against founder | Legal Action Against Individual | Key Figures |
| FTX exchange collapse event | Exchange Insolvency | Risk & Warning |
| Terra Luna collapse impact | Systemic Risk | Risk & Warning |
| Celsius Network freezes withdrawals | Exchange Insolvency | Risk & Warning |
| Genesis Trading halts operations | Exchange Insolvency | Risk & Warning |
| Three Arrows Capital bankruptcy | Systemic Risk | Risk & Warning |
| USDC temporary depeg | Systemic Risk | Risk & Warning |
| Mt. Gox distributing BTC to creditors | Whale Distribution | Whale & On-chain |
| SEC sues Binance and Coinbase | Enforcement Action | Regulation & Legal |
| Silvergate Bank closes | Exchange Insolvency | Risk & Warning |
| Tether FUD - reserve concerns | Regulatory Risk | Risk & Warning |
| Mining ban in Kazakhstan | International Sanctions or Bans | Regulation & Legal |
| China tightens crypto regulations again | International Sanctions or Bans | Regulation & Legal |
| Iran temporary mining ban | International Sanctions or Bans | Regulation & Legal |
| US debt ceiling concerns | Quantitative Easing or Tightening | Macroeconomic |
| Grayscale GBTC discount widening | ETF Flow | Market Performance |
| Leverage ratio too high - cascade liquidation risk | Liquidation Event | Exchange & Trading |
| Dormant BTC wallet suddenly moves funds | On-chain Flow Anomaly | Whale & On-chain |
| SEC investigates staking services | Enforcement Action | Regulation & Legal |
| CBDC competing with crypto | Government Stance | Regulation & Legal |
| Whale sends large BTC to exchange | Whale Distribution | Whale & On-chain |

</details>

<details>
<summary><b>20 factors trung tính (neutral)</b> (nhấn để mở)</summary>

| Factor | → Loại sự kiện | → Nhóm |
|--------|-------------|---------|
| Market sideways waiting for signal | Market Cap Milestone | Market Performance |
| Analyst opinions divided | Analyst or Influencer Opinion | Industry Standards & Opinions |
| Neutral industry report | Industry Report | Industry Standards & Opinions |
| Protocol proposal under review | Protocol Proposal | Industry Standards & Opinions |
| Routine developer milestone | Development Milestone | Technology & Development |
| Minor sector rotation | Sector Rotation | Market Performance |
| Market cap stable | Market Cap Milestone | Market Performance |
| Normal on-chain flow | On-chain Flow Anomaly | Whale & On-chain |
| New testnet under testing | Testnet or Mainnet Launch | Protocol & Product |
| Industry report compilation | Industry Report | Industry Standards & Opinions |
| Consolidation phase - accumulation | Market Cap Milestone | Market Performance |
| Neutral funding rate | Liquidation Event | Exchange & Trading |
| Open interest stable | Liquidation Event | Exchange & Trading |
| Hashrate unchanged | Hash Rate Change | Protocol & Product |
| DXY sideways | Dollar Index Movement | Macroeconomic |
| No notable macro data | Inflation Data | Macroeconomic |
| Weekend options expiry | Listing or Delisting | Exchange & Trading |
| Bitcoin Pizza Day - no price impact | Market Cap Milestone | Market Performance |
| Crypto conference in Europe | Alliance Formation | Partnership & Adoption |
| US Congress crypto hearing | Legislation Progress | Regulation & Legal |

</details>

---

## Ví dụ Input

### Ví dụ 1: Single-day — Ngày bullish mạnh

```json
{
  "date": "2024-01-15",
  "asset": "BTC",
  "msi": 72.5,
  "rsi": 65.3,
  "sentiment_score_avg": 0.82,
  "text": "Bitcoin surges past $43K as ETF inflows hit record highs. Whale accumulation continues with BlackRock adding to positions.",
  "factors": [
    "Record ETF inflows",
    "Strong whale accumulation",
    "BlackRock increases BTC holdings",
    "Significant volume surge"
  ],
  "fear_greed_index": 78,
  "price": 43250.00,
  "price_change_pct": 4.15
}
```

**Phân tích input này:**
- 4 factors → tất cả bullish → typeVec sẽ có 4 bits bật (ETF Flow, Whale Accumulation, Institutional Adoption, Volume Surge)
- groupVec sẽ có 3 bits bật (Market Performance, Whale & On-chain, Partnership & Adoption)
- Numerical indicators cao (msi=72.5, rsi=65.3, sentiment=0.82, fgi=78, pct=+4.15) → sau z-score sẽ là giá trị dương → kết hợp với binary vectors tạo ra vector đại diện cho ngày bullish

### Ví dụ 2: Single-day — Ngày bearish

```json
{
  "date": "2024-03-10",
  "asset": "BTC",
  "msi": 35.2,
  "rsi": 32.1,
  "sentiment_score_avg": -0.55,
  "text": "BTC drops below $40K amid ETF outflows and rising dollar. Liquidation cascade hits leveraged longs.",
  "factors": [
    "Significant ETF outflows",
    "Dollar index surging",
    "Large market liquidations",
    "Leverage ratio too high - cascade liquidation risk"
  ],
  "fear_greed_index": 25,
  "price": 39500.00,
  "price_change_pct": -5.20
}
```

### Ví dụ 3: Window search — 5 ngày downtrend

```json
[
  {
    "date": "2024-03-10",
    "asset": "BTC",
    "msi": 55.0,
    "rsi": 52.0,
    "sentiment_score_avg": 0.30,
    "text": "Market shows signs of weakness",
    "factors": ["Volume declining - liquidity drying up", "Analyst opinions divided"],
    "fear_greed_index": 50,
    "price": 42000,
    "price_change_pct": -0.50
  },
  {
    "date": "2024-03-11",
    "asset": "BTC",
    "msi": 48.0,
    "rsi": 46.5,
    "sentiment_score_avg": 0.10,
    "text": "Continued selling pressure",
    "factors": ["Stablecoin outflows from exchanges", "BTC dominance declining"],
    "fear_greed_index": 42,
    "price": 41200,
    "price_change_pct": -1.90
  },
  {
    "date": "2024-03-12",
    "asset": "BTC",
    "msi": 42.0,
    "rsi": 38.2,
    "sentiment_score_avg": -0.25,
    "text": "Bears take control",
    "factors": ["Dollar index surging", "Bond yield rising - risk for crypto"],
    "fear_greed_index": 35,
    "price": 40100,
    "price_change_pct": -2.67
  },
  {
    "date": "2024-03-13",
    "asset": "BTC",
    "msi": 38.0,
    "rsi": 33.0,
    "sentiment_score_avg": -0.50,
    "text": "Panic selling begins",
    "factors": ["Large market liquidations", "Strong whale selling"],
    "fear_greed_index": 28,
    "price": 38800,
    "price_change_pct": -3.24
  },
  {
    "date": "2024-03-14",
    "asset": "BTC",
    "msi": 32.0,
    "rsi": 28.5,
    "sentiment_score_avg": -0.70,
    "text": "Capitulation day",
    "factors": ["Significant ETF outflows", "Systemic risk concerns", "Miner selling pressure increasing"],
    "fear_greed_index": 18,
    "price": 37200,
    "price_change_pct": -4.12
  }
]
```

---

## Phân biệt vai trò các fields trong vectorization

```
                        ┌─────────────────────────────────────────────┐
                        │           Joint Vector (80 dimensions)       │
                        ├──────────────┬──────────────┬───────────────┤
                        │ typeVec (62) │ groupVec(13) │ α×numeric (5) │
                        ├──────────────┼──────────────┼───────────────┤
Input fields:           │   factors    │   factors    │ msi           │
                        │              │              │ rsi           │
                        │              │              │ sentiment     │
                        │              │              │ fear_greed    │
                        │              │              │ price_change  │
                        ├──────────────┴──────────────┴───────────────┤
Ref paper:              │   StockMem (3)-(4)          │ History Rhymes│
                        └─────────────────────────────────────────────┘

Không tham gia vectorization:
  - date          → temporal exclusion (window search)
  - asset         → metadata
  - text          → hiển thị context
  - price         → metadata (không dùng vì price_change_pct đã capture biến động)
```

---

## Validation

Hệ thống **không throw error** khi input không hợp lệ, nhưng kết quả sẽ kém chính xác:

| Vấn đề | Hậu quả |
|--------|---------|
| Factor string không match `FACTOR_TYPE_MAP` | Factor bị bỏ qua → vector thiếu thông tin → similarity score thấp hơn thực tế |
| `factors` rỗng `[]` | typeVec và groupVec toàn 0 → chỉ dựa vào 5 numerical indicators |
| Numerical indicators = 0 hoặc thiếu | Phần numerical trong vector bị sai lệch → ảnh hưởng đến matching |
| Window không đủ 5 ngày | Vẫn chạy nhưng SeqSim tính trên ít ngày hơn |
