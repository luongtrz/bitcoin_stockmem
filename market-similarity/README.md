# Market Similarity — Kết hợp StockMem + History Rhymes

Tìm kiếm các ngày giao dịch BTC có pattern tương tự nhau, dựa trên sự kết hợp thuật toán từ 2 paper:

- **StockMem** (arXiv:2512.02720) — Vector nhị phân sự kiện + tìm kiếm chuỗi ngày (SeqSim)
- **History Rhymes** (Khanna, 2024) — Ghép chỉ số số học với trọng số α + L2-normalize + Inner product

## Mục lục

- [Input Format](#input-format)
- [Flow xử lý](#flow-xử-lý)
  - [Bước 1: Factor → Event Taxonomy Mapping (StockMem)](#bước-1-factor--event-taxonomy-mapping-stockmem)
  - [Bước 2: Binary Event Vectors (StockMem công thức 3-4)](#bước-2-binary-event-vectors-stockmem-công-thức-3-4)
  - [Bước 3: Numerical Indicators + Z-score (History Rhymes)](#bước-3-numerical-indicators--z-score-history-rhymes)
  - [Bước 4: Concat + L2-Normalize (History Rhymes)](#bước-4-concat--l2-normalize-history-rhymes)
  - [Bước 5: Similarity Search](#bước-5-similarity-search)
  - [Bước 6: Window Search — SeqSim (StockMem công thức 8)](#bước-6-window-search--seqsim-stockmem-công-thức-8)
- [Output Format](#output-format)
- [Paper References](#paper-references)
- [Architecture](#architecture)
- [API Usage](#api-usage)
- [CLI Usage](#cli-usage)

---

## Input Format

Mỗi ngày giao dịch là 1 JSON object `DailyJsonInput`:

```json
{
  "date": "2024-01-15",
  "asset": "BTC",
  "msi": 62.5,
  "rsi": 58.3,
  "sentiment_score_avg": 0.72,
  "text": "Bitcoin tăng mạnh nhờ dòng tiền ETF...",
  "factors": [
    "Record ETF inflows",
    "Fed holds interest rate steady",
    "Strong whale accumulation"
  ],
  "fear_greed_index": 71,
  "price": 42850.00,
  "price_change_pct": 3.25
}
```

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `date` | `string` | Ngày giao dịch (YYYY-MM-DD) |
| `asset` | `string` | Loại tài sản (hiện tại: "BTC") |
| `msi` | `number` | Chỉ số sức mạnh thị trường (0-100) |
| `rsi` | `number` | Chỉ số RSI (0-100) |
| `sentiment_score_avg` | `number` | Trung bình điểm tâm lý thị trường (-1 đến 1) |
| `text` | `string` | Tóm tắt thị trường trong ngày (không dùng trong vector hóa) |
| `factors` | `string[]` | Danh sách sự kiện/yếu tố ảnh hưởng — **phải khớp chính xác** với `FACTOR_TYPE_MAP` trong `src/taxonomy.ts` (99 factors: 39 tăng, 40 giảm, 20 trung tính) |
| `fear_greed_index` | `number` | Chỉ số Sợ hãi & Tham lam (0-100) |
| `price` | `number` | Giá BTC (USD) |
| `price_change_pct` | `number` | % thay đổi giá so với ngày trước |

---

## Flow xử lý

### Bước 1: Factor → Event Taxonomy Mapping (StockMem)

**Tham chiếu: StockMem Mục 3.3, Phụ lục A**

Mỗi factor string được phân loại sang 1 loại sự kiện trong bảng phân loại 13 nhóm × 62 loại.

```
"Record ETF inflows"                  →  loại: "ETF Flow"              →  nhóm: "Market Performance"
"Fed holds interest rate steady"      →  loại: "Interest Rate Decision" →  nhóm: "Macroeconomic"
"Strong whale accumulation"           →  loại: "Whale Accumulation"    →  nhóm: "Whale & On-chain"
```

Bảng phân loại gồm 13 nhóm:

| # | Nhóm | Số loại sự kiện |
|---|------|----------------|
| 1 | Quy định & Pháp lý | 5 |
| 2 | Kinh tế vĩ mô | 4 |
| 3 | Tiêu chuẩn & Ý kiến ngành | 3 |
| 4 | Giao thức & Sản phẩm | 7 |
| 5 | Công nghệ & Phát triển | 6 |
| 6 | Sàn giao dịch & Trading | 8 |
| 7 | DeFi & Hệ sinh thái | 3 |
| 8 | Cá voi & On-chain | 4 |
| 9 | Nhân vật chủ chốt | 3 |
| 10 | Hiệu suất thị trường | 6 |
| 11 | Tài chính truyền thống liên kết | 4 |
| 12 | Hợp tác & Ứng dụng | 4 |
| 13 | Rủi ro & Cảnh báo | 5 |
| | **Tổng** | **62 loại** |

File: `src/taxonomy.ts`

### Bước 2: Binary Event Vectors (StockMem công thức 3-4)

**Tham chiếu: StockMem Mục 3.3, Công thức (3) và (4)**

Từ danh sách factors đã map, tạo 2 binary vectors:

**Công thức (3) — typeVec (62 chiều):**

```
V_t[m] = 1  nếu ngày t có loại sự kiện m
V_t[m] = 0  nếu không
```

Ví dụ: nếu ngày có factor "Record ETF inflows" → `loại = "ETF Flow"` → chỉ số 44 → `typeVec[44] = 1`

**Công thức (4) — groupVec (13 chiều):**

```
G_t[g] = 1  nếu nhóm g có ít nhất 1 loại sự kiện xuất hiện
G_t[g] = 0  nếu không
```

Ví dụ: "ETF Flow" thuộc nhóm "Market Performance" → chỉ số 9 → `groupVec[9] = 1`

File: `src/taxonomy.ts` — `buildTypeVector()`, `buildGroupVector()`

### Bước 3: Numerical Indicators + Z-score (History Rhymes)

**Tham chiếu: History Rhymes (Khanna, 2024) — concat numerical indicators**

Trích xuất 5 numerical indicators:

```
numeric = [msi, rsi, sentiment_score_avg, fear_greed_index, price_change_pct]
```

Z-score normalization trên toàn bộ dataset (để các chỉ số có scale tương đương):

```
z_i = (x_i - μ_i) / σ_i
```

Trong đó `μ_i` và `σ_i` tính từ tất cả records trong database.

Scale với trọng số α = 0.5 (History Rhymes):

```
scaled_numeric = α × z_normalized_numeric  (α = 0.5)
```

File: `src/vectorize.ts` — `extractNumerical()`, `zScoreNormalize()`, `computeNormStats()`

### Bước 4: Concat + L2-Normalize (History Rhymes)

**Tham chiếu: History Rhymes — Joint vector = [features; α × numerical] → L2-normalize → Inner product**

Concat 3 phần thành 1 joint vector 80 chiều:

```
joint_vec = [ typeVec(62 chiều) ; groupVec(13 chiều) ; α × numeric(5 chiều) ]
                                                                    = 80 chiều tổng cộng
```

L2-normalize để đưa về unit sphere:

```
joint_vec_normalized = joint_vec / ‖joint_vec‖₂

trong đó ‖v‖₂ = √(v₁² + v₂² + ... + v₈₀²)
```

Sau L2-normalize, inner product = cosine similarity (vì tất cả vectors nằm trên unit sphere).

File: `src/vectorize.ts` — `vectorize()`, `l2Normalize()`

### Bước 5: Similarity Search

**Tham chiếu: History Rhymes — Inner product trên vector đã L2-normalize**

**Single-day search (DailySim):**

```
DailySim(A, B) = inner_product(joint_vecA, joint_vecB)
               = Σᵢ joint_vecA[i] × joint_vecB[i]
```

Vì đã L2-normalize → `DailySim ∈ [-1, 1]`, trong đó:
- `1.0` = hoàn toàn giống nhau
- `0.0` = không liên quan
- `-1.0` = hoàn toàn ngược lại

Brute-force search qua toàn bộ records, sort giảm dần, trả về top-K.

File: `src/search.ts` — `searchTopK()`

### Bước 6: Window Search — SeqSim (StockMem công thức 8)

**Tham chiếu: StockMem Mục 3.3, Công thức (8)**

Tìm chuỗi W ngày liên tiếp (mặc định W=5) có pattern giống nhất:

```
SeqSim(Q, C) = (1/W) × Σₖ₌₁ᵂ DailySim(Q[W-k], C[W-k])
```

- **Aligned from end**: so sánh ngày cuối query với ngày cuối candidate, ngày áp cuối với áp cuối, v.v. (theo đúng công thức 8 trong paper)
- **Temporal exclusion**: candidate window phải nằm **trước** query window (ngày cuối candidate < ngày đầu query) — tránh data leakage
- **Sliding window**: duyệt qua toàn bộ records với step=1

```
Query window:     [Q₁, Q₂, Q₃, Q₄, Q₅]
Candidate window: [C₁, C₂, C₃, C₄, C₅]

DailySim pairs (aligned from end):
  Q₅ ↔ C₅  (ngày gần nhất)
  Q₄ ↔ C₄
  Q₃ ↔ C₃
  Q₂ ↔ C₂
  Q₁ ↔ C₁  (ngày xa nhất)

SeqSim = trung bình cộng 5 điểm DailySim
```

File: `src/search.ts` — `searchTopKWindows()`

---

## Output Format

### Single-day search response

```json
[
  {
    "rank": 1,
    "score": 0.8234,
    "record": {
      "date": "2023-11-20",
      "asset": "BTC",
      "msi": 65.1,
      "rsi": 55.7,
      "sentiment_score_avg": 0.68,
      "text": "...",
      "factors": ["Record ETF inflows", "Strong whale accumulation"],
      "fear_greed_index": 68,
      "price": 37250.00,
      "price_change_pct": 2.80
    }
  }
]
```

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `rank` | `number` | Thứ hạng (1 = giống nhất) |
| `score` | `number` | DailySim score — inner product của L2-normalized joint vectors ∈ [-1, 1] |
| `record` | `DailyJsonInput` | Toàn bộ dữ liệu của ngày tương tự |

### Window search response

```json
[
  {
    "rank": 1,
    "score": 0.6842,
    "daily_scores": [0.5921, 0.6534, 0.7102, 0.7245, 0.7408],
    "window": [
      { "date": "2023-03-01", "..." : "..." },
      { "date": "2023-03-02", "..." : "..." },
      { "date": "2023-03-03", "..." : "..." },
      { "date": "2023-03-04", "..." : "..." },
      { "date": "2023-03-05", "..." : "..." }
    ]
  }
]
```

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `rank` | `number` | Thứ hạng |
| `score` | `number` | SeqSim = trung bình daily_scores (StockMem công thức 8) |
| `daily_scores` | `number[]` | DailySim từng cặp ngày (aligned from end) |
| `window` | `DailyJsonInput[]` | W ngày liên tiếp của candidate |

---

## Paper References

### StockMem (arXiv:2512.02720)

> "StockMem: A memory-augmented LLM framework for stock price prediction"

| Khái niệm | Paper Section | Code Location |
|-----------|----------------|-------------|
| Event Taxonomy (13 groups, 62 types) | Section 3.3, Appendix A | `src/taxonomy.ts` — `EVENT_TAXONOMY` |
| typeVec — binary event type vector | Formula (3) | `src/taxonomy.ts` — `buildTypeVector()` |
| groupVec — binary group vector | Formula (4) | `src/taxonomy.ts` — `buildGroupVector()` |
| DailySim — similarity giữa 2 ngày | Formulas (5)-(7) | `src/search.ts` — `searchTopK()` |
| SeqSim — window similarity (W=5) | Formula (8) | `src/search.ts` — `searchTopKWindows()` |
| Temporal exclusion | Section 3.3 | `src/search.ts:79` — `candRecords[W-1].date >= queryStartDate` |

**Ghi chú**: Paper gốc dùng Jaccard similarity riêng cho typeVec và groupVec (TypeSim, GroupSim), sau đó weighted sum. Trong implementation này, typeVec và groupVec được **concat** vào joint vector thay vì tính Jaccard riêng — theo approach của History Rhymes (xem bên dưới).

### History Rhymes (Khanna, 2024)

> "History Rhymes: Using historical analogues for market prediction"

| Khái niệm | Paper Section | Code Location |
|-----------|----------------|-------------|
| Joint vector = [features; α × numerical] | Core methodology | `src/vectorize.ts` — `vectorize()` |
| α = 0.5 (numerical weight) | Hyperparameter | `src/config.ts` — `ALPHA = 0.5` |
| L2-normalize → inner product = cosine | Similarity metric | `src/vectorize.ts` — `l2Normalize()` |
| Concat features + numerical indicators | Vector construction | `src/vectorize.ts:89` |

**Key insight**: History Rhymes cung cấp cơ chế kết hợp features (categorical/binary) với numerical indicators bằng cách:
1. Concat vào chung 1 vector
2. Scale numerical với α=0.5 để cân bằng ảnh hưởng
3. L2-normalize toàn bộ vector
4. Inner product (= cosine similarity trên unit vectors)

### Hybrid Approach — Kết hợp 2 papers

Cơ chế của History Rhymes (`[features; α × numerical] → L2-norm → inner product`) được áp dụng với:
- **Features** = binary vectors từ StockMem (`typeVec_62d` + `groupVec_13d`)
- **Numerical** = market indicators (`msi`, `rsi`, `sentiment`, `fear_greed`, `pct_change`) với z-score normalization

```
Joint vector (80 chiều) = [typeVec(62) ; groupVec(13) ; 0.5 × z_numeric(5)]
                           ╰── StockMem ──╯              ╰── History Rhymes ──╯
                        → L2-normalize (History Rhymes)
                        → Tìm kiếm bằng inner product
                        → SeqSim chuỗi ngày (StockMem công thức 8)
```

---

## Architecture

```
market-similarity/
├── api/
│   └── search.ts          # Vercel serverless handler (POST /api/search)
├── data/
│   ├── *.json             # Dữ liệu giao dịch theo ngày
│   └── bundle.json        # Dữ liệu đã gom + vector hóa sẵn (cho serverless)
├── scripts/
│   ├── generate-data.ts   # Regime-based synthetic data generator
│   ├── bundle-data.ts     # Bundle tất cả JSON + pre-vectorize
│   └── eval-accuracy.ts   # Evaluation: self-retrieval, category match, v.v.
├── src/
│   ├── types.ts           # Type definitions
│   ├── config.ts          # Hyperparameters (α=0.5, W=5, K=5)
│   ├── taxonomy.ts        # StockMem event taxonomy (13 groups, 62 types, 99 factors)
│   ├── vectorize.ts       # Hybrid vectorization (StockMem + History Rhymes)
│   ├── search.ts          # Similarity search (DailySim + SeqSim)
│   ├── store.ts           # Orchestration layer
│   ├── cli.ts             # CLI interface
│   └── storage/
│       ├── database.ts    # SQLite storage (local development)
│       └── memory.ts      # In-memory storage (Vercel serverless)
├── docs/
│   ├── simple.md          # Giải thích đơn giản dễ hiểu
│   ├── input.md           # Chi tiết input
│   ├── flow.md            # Chi tiết flow xử lý
│   └── output.md          # Chi tiết output
└── vercel.json            # Vercel deployment config
```

### Data Flow

```
[Local]
  Raw JSON files → generate-data.ts → data/*.json
  data/*.json → bundle-data.ts → data/bundle.json (pre-vectorized)

[Serverless — Cold Start]
  data/bundle.json → memory.ts → StoredRecord[] (in-memory cache)

[Request]
  POST body (DailyJsonInput) → vectorize() → joint vector 80 chiều
    → searchTopK() / searchTopKWindows() → top-K results → JSON response
```

---

## API Usage

**Endpoint**: `POST /api/search`

### Single-day search

```bash
curl -X POST https://market-similarity.vercel.app/api/search?k=5 \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2024-01-15",
    "asset": "BTC",
    "msi": 62.5,
    "rsi": 58.3,
    "sentiment_score_avg": 0.72,
    "text": "Bitcoin tăng mạnh nhờ ETF",
    "factors": [
      "Record ETF inflows",
      "Fed holds interest rate steady",
      "Strong whale accumulation"
    ],
    "fear_greed_index": 71,
    "price": 42850,
    "price_change_pct": 3.25
  }'
```

### Window search (5 ngày)

```bash
curl -X POST https://market-similarity.vercel.app/api/search?k=3 \
  -H "Content-Type: application/json" \
  -d '[
    { "date": "2024-01-15", "asset": "BTC", "msi": 62.5, "rsi": 58.3, "sentiment_score_avg": 0.72, "text": "...", "factors": ["Record ETF inflows"], "fear_greed_index": 71, "price": 42850, "price_change_pct": 3.25 },
    { "date": "2024-01-16", "asset": "BTC", "msi": 60.1, "rsi": 56.0, "sentiment_score_avg": 0.55, "text": "...", "factors": ["Analyst opinions divided"], "fear_greed_index": 65, "price": 42500, "price_change_pct": -0.82 },
    { "date": "2024-01-17", "asset": "BTC", "msi": 58.0, "rsi": 52.1, "sentiment_score_avg": 0.40, "text": "...", "factors": ["Volume declining - liquidity drying up"], "fear_greed_index": 55, "price": 41800, "price_change_pct": -1.65 },
    { "date": "2024-01-18", "asset": "BTC", "msi": 55.0, "rsi": 48.5, "sentiment_score_avg": 0.30, "text": "...", "factors": ["Stablecoin outflows from exchanges"], "fear_greed_index": 42, "price": 41200, "price_change_pct": -1.44 },
    { "date": "2024-01-19", "asset": "BTC", "msi": 52.0, "rsi": 45.0, "sentiment_score_avg": 0.25, "text": "...", "factors": ["Dollar index surging"], "fear_greed_index": 38, "price": 40500, "price_change_pct": -1.70 }
  ]'
```

**Auto-detect**: Body là object → single-day search. Body là array → window search.

---

## CLI Usage

```bash
# Index data
npx tsx src/cli.ts index --file data/btc_2020.json

# Single-day search
npx tsx src/cli.ts search --json '{"date":"2024-01-15","asset":"BTC","msi":62.5,"rsi":58.3,"sentiment_score_avg":0.72,"text":"...","factors":["Record ETF inflows"],"fear_greed_index":71,"price":42850,"price_change_pct":3.25}'

# Window search (pass array)
npx tsx src/cli.ts search --json '[{...}, {...}, {...}, {...}, {...}]'

# List tất cả ngày đã index
npx tsx src/cli.ts list

# Evaluate accuracy
npx tsx scripts/eval-accuracy.ts

# Bundle data cho serverless
npx tsx scripts/bundle-data.ts
```

---

## Tài liệu chi tiết

| Tài liệu | Mô tả |
|-----------|-------|
| [docs/simple.md](docs/simple.md) | Giải thích đơn giản, dễ hiểu nhất |
| [docs/input.md](docs/input.md) | Chi tiết đầu vào — schema, từng trường, 99 factors |
| [docs/flow.md](docs/flow.md) | Chi tiết luồng xử lý — 6 bước với công thức và ví dụ |
| [docs/output.md](docs/output.md) | Chi tiết đầu ra — cách đọc score, ứng dụng thực tế |
