# Output — Kết quả đầu ra

## Tổng quan

Hệ thống trả về 2 loại output tùy theo input:

| Input | Search type | Output type | Mô tả |
|-------|------------|-------------|-------|
| 1 JSON object `{...}` | Single-day | `SearchResult[]` | Top-K ngày đơn lẻ giống nhất |
| 1 JSON array `[{...}, ...]` | Window (W=5) | `WindowSearchResult[]` | Top-K chuỗi W ngày liên tiếp giống nhất |

Response luôn là JSON array, sort theo score giảm dần (giống nhất đầu tiên).

---

## Output 1: Single-day Search — `SearchResult[]`

### Schema

```typescript
interface SearchResult {
  rank: number;        // Thứ hạng: 1 = giống nhất
  score: number;       // DailySim score ∈ [-1, 1]
  record: DailyJsonInput;  // Toàn bộ data của ngày tương tự
}
```

### Ví dụ phản hồi

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
      "text": "Bitcoin rallies on ETF approval optimism. Whale wallets show accumulation pattern.",
      "factors": [
        "Record ETF inflows",
        "Strong whale accumulation",
        "Significant volume surge"
      ],
      "fear_greed_index": 68,
      "price": 37250.00,
      "price_change_pct": 2.80
    }
  },
  {
    "rank": 2,
    "score": 0.7156,
    "record": {
      "date": "2023-07-14",
      "asset": "BTC",
      "msi": 60.3,
      "rsi": 58.2,
      "sentiment_score_avg": 0.55,
      "text": "Positive momentum continues with institutional buying...",
      "factors": [
        "BlackRock increases BTC holdings",
        "Institutional adoption increasing"
      ],
      "fear_greed_index": 62,
      "price": 31420.00,
      "price_change_pct": 1.95
    }
  },
  {
    "rank": 3,
    "score": 0.6523,
    "record": { "..." : "..." }
  },
  {
    "rank": 4,
    "score": 0.5891,
    "record": { "..." : "..." }
  },
  {
    "rank": 5,
    "score": 0.5234,
    "record": { "..." : "..." }
  }
]
```

### Chi tiết từng field

#### `rank` — Thứ hạng

- **Kiểu**: `number`
- **Giá trị**: 1, 2, 3, ..., K
- **Ý nghĩa**: `rank = 1` là ngày giống nhất. Thứ tự dựa trên `score` giảm dần.

#### `score` — DailySim Score

- **Kiểu**: `number`
- **Phạm vi**: [-1, 1] (lý thuyết), thực tế thường [0, 1] với binary vectors
- **Precision**: Làm tròn 4 chữ số thập phân
- **Công thức**:
  ```
  score = inner_product(query_joint_vec, candidate_joint_vec)
        = Σᵢ₌₁⁸⁰ query[i] × candidate[i]
  ```
- **Ref**: History Rhymes — inner product trên L2-normalized vectors = cosine similarity

**Cách đọc score:**

| Score | Ý nghĩa thực tế |
|-------|-----------------|
| 0.90 - 1.00 | Gần như giống hệt: cùng factors, cùng market regime, numerical rất gần |
| 0.70 - 0.90 | Rất giống: phần lớn factors chung, cùng xu hướng thị trường |
| 0.50 - 0.70 | Khá giống: một số factors chung, xu hướng tương tự nhưng khác biệt rõ |
| 0.30 - 0.50 | Ít giống: vài factors chung hoặc chỉ numerical gần nhau |
| 0.10 - 0.30 | Hầu như khác: rất ít điểm chung |
| < 0.10 | Không liên quan hoặc ngược hướng |

**Yếu tố ảnh hưởng score:**

Score phụ thuộc vào 2 thành phần trong joint vector:

```
Binary vectors (75/80 dimensions = 93.75%):
  - Matching factors → matching bits trong typeVec/groupVec
  - Nhiều factors chung → score cao hơn
  - Binary nên mỗi bit đóng góp đồng đều

Numerical indicators (5/80 dimensions = 6.25%):
  - Nhưng sau z-score + α=0.5, magnitude ~0.25-0.75
  - Numerical gần nhau → đóng góp dương nhỏ vào score
  - Numerical ngược nhau → đóng góp âm nhỏ
```

Do binary chiếm phần lớn dimensions, **factors matching là yếu tố chính** quyết định score. Numerical indicators đóng vai trò **fine-tuning** (phân biệt giữa các ngày có cùng factors nhưng khác indicators).

#### `record` — Dữ liệu ngày tương tự

- **Kiểu**: `DailyJsonInput`
- **Nội dung**: Toàn bộ dữ liệu gốc của ngày tương tự (giống hệt lúc nhập)
- **Bao gồm**: date, asset, msi, rsi, sentiment_score_avg, text, factors, fear_greed_index, price, price_change_pct

Người dùng có thể:
- So sánh factors giữa query và result để hiểu **tại sao** hệ thống cho rằng giống nhau
- Đọc `text` để xem context thị trường
- So sánh numerical indicators (msi, rsi, sentiment, fgi, pct_change) để xem mức độ tương đồng

---

## Output 2: Window Search — `WindowSearchResult[]`

### Schema

```typescript
interface WindowSearchResult {
  rank: number;           // Thứ hạng: 1 = giống nhất
  score: number;          // SeqSim = trung bình daily_scores
  daily_scores: number[]; // DailySim cho từng cặp ngày (W phần tử)
  window: DailyJsonInput[];  // W ngày liên tiếp của candidate
}
```

### Ví dụ phản hồi

```json
[
  {
    "rank": 1,
    "score": 0.6842,
    "daily_scores": [0.5921, 0.6534, 0.7102, 0.7245, 0.7408],
    "window": [
      {
        "date": "2023-06-15",
        "asset": "BTC",
        "msi": 53.0,
        "rsi": 50.2,
        "sentiment_score_avg": 0.25,
        "text": "Market consolidation with declining volume...",
        "factors": ["Volume declining - liquidity drying up", "DXY sideways"],
        "fear_greed_index": 48,
        "price": 25800,
        "price_change_pct": -0.35
      },
      {
        "date": "2023-06-16",
        "asset": "BTC",
        "msi": 47.5,
        "rsi": 45.8,
        "sentiment_score_avg": 0.10,
        "text": "Bearish momentum building...",
        "factors": ["Stablecoin outflows from exchanges", "BTC dominance declining"],
        "fear_greed_index": 40,
        "price": 25200,
        "price_change_pct": -2.33
      },
      {
        "date": "2023-06-17",
        "asset": "BTC",
        "msi": 41.0,
        "rsi": 37.5,
        "sentiment_score_avg": -0.30,
        "text": "Dollar strengthens, crypto weakens...",
        "factors": ["Dollar index surging", "Bond yield rising - risk for crypto"],
        "fear_greed_index": 33,
        "price": 24500,
        "price_change_pct": -2.78
      },
      {
        "date": "2023-06-18",
        "asset": "BTC",
        "msi": 36.0,
        "rsi": 31.5,
        "sentiment_score_avg": -0.55,
        "text": "Heavy selling across the board...",
        "factors": ["Large market liquidations", "Strong whale selling"],
        "fear_greed_index": 26,
        "price": 23800,
        "price_change_pct": -2.86
      },
      {
        "date": "2023-06-19",
        "asset": "BTC",
        "msi": 30.5,
        "rsi": 26.0,
        "sentiment_score_avg": -0.72,
        "text": "Capitulation with record outflows...",
        "factors": ["Significant ETF outflows", "Systemic risk concerns", "Miner selling pressure increasing"],
        "fear_greed_index": 16,
        "price": 22900,
        "price_change_pct": -3.78
      }
    ]
  },
  {
    "rank": 2,
    "score": 0.6215,
    "daily_scores": [0.5412, 0.6023, 0.6345, 0.6678, 0.6617],
    "window": [ "..." ]
  }
]
```

### Chi tiết từng field

#### `rank` — Thứ hạng

Giống single-day. `rank = 1` = chuỗi W ngày giống nhất.

#### `score` — SeqSim Score

- **Kiểu**: `number`
- **Phạm vi**: [-1, 1], thực tế thường [0.3, 0.8]
- **Precision**: 4 chữ số thập phân
- **Công thức**:
  ```
  SeqSim = (1/W) × Σₖ₌₁ᵂ DailySim(Q[W-k], C[W-k])
         = trung bình cộng của daily_scores
  ```
- **Ref**: StockMem Section 3.3, Formula (8)

**Tại sao SeqSim thường thấp hơn single-day score?**

SeqSim là trung bình của W daily scores. Để score cao, **tất cả W ngày** đều phải giống nhau — khó hơn nhiều so với chỉ 1 ngày. Khoảng SeqSim hợp lý:

| SeqSim | Ý nghĩa |
|--------|---------|
| > 0.70 | Chuỗi rất giống: cùng xu hướng, cùng loại sự kiện liên tiếp |
| 0.50 - 0.70 | Chuỗi khá giống: xu hướng tương tự, một vài ngày khác biệt |
| 0.30 - 0.50 | Chuỗi hơi giống: xu hướng chung giống nhưng chi tiết khác nhiều |
| < 0.30 | Ít giống nhau |

#### `daily_scores` — DailySim từng cặp ngày

- **Kiểu**: `number[]` (W phần tử)
- **Ý nghĩa**: `daily_scores[i]` = DailySim giữa query ngày thứ i và candidate ngày thứ i

```
daily_scores[0] = DailySim(Q₁, C₁)  ← ngày đầu (xa nhất)
daily_scores[1] = DailySim(Q₂, C₂)
daily_scores[2] = DailySim(Q₃, C₃)
daily_scores[3] = DailySim(Q₄, C₄)
daily_scores[4] = DailySim(Q₅, C₅)  ← ngày cuối (gần nhất)
```

**Cách đọc daily_scores:**

Cho phép xem **ngày nào giống nhất** và **ngày nào khác nhất** trong chuỗi:

```json
"daily_scores": [0.5921, 0.6534, 0.7102, 0.7245, 0.7408]
                  │                                  │
                  └── Ngày đầu: ít giống nhất        └── Ngày cuối: giống nhất
```

Trong ví dụ trên, chuỗi ngày **càng về cuối càng giống** — có thể hiểu là cả query và candidate đều có xu hướng bearish tăng dần, và giai đoạn capitulation cuối cùng là giống nhất.

**Aligned from end** (StockMem Formula 8): daily_scores[4] so sánh ngày cuối query với ngày cuối candidate (không phải ngày đầu). Điều này quan trọng vì ngày gần nhất thường có ý nghĩa nhất cho prediction.

#### `window` — Dữ liệu W ngày candidate

- **Kiểu**: `DailyJsonInput[]` (W phần tử)
- **Thứ tự**: Theo thời gian tăng dần (window[0] = ngày đầu, window[W-1] = ngày cuối)
- **Nội dung**: Toàn bộ dữ liệu gốc của từng ngày

Người dùng có thể:
- So sánh từng cặp `(query_day[i], window[i])` cùng với `daily_scores[i]` để hiểu matching
- Xem trend của candidate window (price_change_pct, sentiment, fear_greed qua các ngày)
- Đọc text để hiểu context thị trường lịch sử

---

## So sánh 2 loại output

| | Single-day | Window |
|---|-----------|--------|
| **Input** | 1 JSON object | JSON array (W objects) |
| **Output type** | `SearchResult[]` | `WindowSearchResult[]` |
| **Score metric** | DailySim (inner product) | SeqSim (avg DailySim, formula 8) |
| **Score range** | Thường 0.4 - 0.9 | Thường 0.3 - 0.7 |
| **Temporal exclusion** | Không | Có — candidate trước query |
| **Extra fields** | — | `daily_scores[]` per-day breakdown |
| **Use case** | "Hôm nay giống ngày nào?" | "Tuần này giống tuần nào?" |
| **Ref** | History Rhymes | StockMem Formula (8) |

---

## Cách sử dụng output

### Use case 1: Phân tích ngày hiện tại

Gửi dữ liệu ngày hôm nay → xem top-5 ngày lịch sử giống nhất → kiểm tra **ngày hôm sau** của các ngày đó đã xảy ra gì.

```
Hôm nay (query) → Top-1 match: 2023-11-20 (score 0.82)
                   → 2023-11-21: BTC +2.5% (continued rally)

                → Top-2 match: 2023-07-14 (score 0.72)
                   → 2023-07-15: BTC -0.8% (pullback)

→ Kết luận: Lịch sử cho thấy 2/5 ngày giống tiếp tục tăng, 3/5 đi ngang
```

### Use case 2: Pattern recognition chuỗi ngày

Gửi 5 ngày gần nhất → xem top-3 chuỗi lịch sử giống nhất → xem **ngày thứ 6** đã xảy ra gì.

```
5 ngày gần nhất (downtrend) → Top-1 match: 2023-06-15~19 (SeqSim 0.68)
                               → 2023-06-20: BTC +5.2% (bounce)

                             → Top-2 match: 2022-11-07~11 (SeqSim 0.62)
                               → 2022-11-12: BTC -15% (FTX collapse continues)

→ Kết luận: Cần xem thêm context — cùng pattern nhưng outcome khác nhau
```

### Use case 3: So sánh chi tiết factors

Dùng `record.factors` trong output để so sánh:

```
Query factors:  ["Record ETF inflows", "Strong whale accumulation"]
Result factors: ["Record ETF inflows", "BlackRock increases BTC holdings", "Significant volume surge"]

Chung: "Record ETF inflows" (ETF Flow)
Khác:  Query có whale, Result có BlackRock + volume
→ Cùng nhóm bullish nhưng drivers khác nhau
```

---

## HTTP Response Format

### Success (200)

```json
// Single-day
[
  { "rank": 1, "score": 0.8234, "record": { ... } },
  { "rank": 2, "score": 0.7156, "record": { ... } }
]

// Window
[
  { "rank": 1, "score": 0.6842, "daily_scores": [...], "window": [...] },
  { "rank": 2, "score": 0.6215, "daily_scores": [...], "window": [...] }
]
```

### Error (400)

```json
{ "error": "Request body required." }
```

### Error (405)

```json
{ "error": "Method not allowed. Use POST." }
```

### Error (500)

```json
{ "error": "Cannot read properties of undefined (reading 'date')" }
```

---

## Query Parameters

| Param | Default | Mô tả |
|-------|---------|-------|
| `k` | `5` | Số lượng kết quả trả về (top-K) |

Ví dụ: `POST /api/search?k=10` → trả về 10 kết quả thay vì 5.

---

## Giới hạn và lưu ý

| Giới hạn | Chi tiết |
|----------|---------|
| **Score không phải probability** | Score 0.7 không có nghĩa "70% giống". Đây là cosine similarity — đo góc giữa 2 vectors trong không gian 80 dimensions. |
| **Phụ thuộc corpus** | Z-score normalization tính từ corpus → thêm/bớt data thay đổi stats → thay đổi vectors → thay đổi scores. Cần re-bundle sau khi thay đổi data. |
| **Factor strings phải match chính xác** | Factor không match → bị bỏ qua → vector thiếu thông tin → score thấp hơn thực tế. Kiểm tra `FACTOR_TYPE_MAP` trong `src/taxonomy.ts`. |
| **Window search chậm hơn** | O(N × W × D) thay vì O(N × D). Với N=1800 records, W=5, D=80: ~720K phép nhân — vẫn dưới 100ms. |
| **Temporal exclusion** | Window search chỉ trả về candidate **trước** query date. Nếu query date quá sớm, ít candidate available → ít results. |
