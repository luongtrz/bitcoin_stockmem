# Flow — Chi tiết xử lý từng bước

## Tổng quan Pipeline

```
Input (DailyJsonInput)
  │
  ▼
Bước 1: Factor Mapping ─── StockMem Section 3.3, Appendix A
  │  factor string → event type → group
  │
  ▼
Bước 2: Binary Vectors ─── StockMem Formulas (3)-(4)
  │  typeVec (62d) + groupVec (13d)
  │
  ▼
Bước 3: Numerical Extraction + Z-score ─── History Rhymes
  │  [msi, rsi, sentiment, fgi, pct_change] → z-score → ×α
  │
  ▼
Bước 4: Concat + L2-Normalize ─── History Rhymes
  │  [typeVec; groupVec; α×numeric] = 80d → L2-norm
  │
  ▼
Bước 5: Similarity Search ─── History Rhymes (inner product)
  │  hoặc
Bước 6: Window Search ─── StockMem Formula (8) (SeqSim)
  │
  ▼
Output (SearchResult[] hoặc WindowSearchResult[])
```

---

## Bước 1: Factor Mapping

**Ref: StockMem (arXiv:2512.02720) Section 3.3, Appendix A**
**File: `src/taxonomy.ts` — `getFactorType()`, `getFactorGroup()`**

### Mô tả

Mỗi factor string trong input được map qua 2 lớp:

```
Factor string  →  Event Type (62 loại)  →  Group (13 nhóm)
```

### Cơ chế mapping

Bảng `FACTOR_TYPE_MAP` chứa 99 factor strings đã được định nghĩa trước, mỗi factor map sang đúng 1 event type. Mỗi event type thuộc đúng 1 group.

```
"Record ETF inflows"
    │
    ▼ (FACTOR_TYPE_MAP lookup)
"ETF Flow"                          ← event type (1 trong 62)
    │
    ▼ (TYPE_TO_GROUP lookup)
"Market Performance"                ← group (1 trong 13)
```

### Ví dụ chi tiết

Giả sử input có factors:
```json
["Record ETF inflows", "Fed holds interest rate steady", "Strong whale accumulation"]
```

Kết quả mapping:

| Factor | Event Type | Group |
|--------|-----------|-------|
| Record ETF inflows | ETF Flow | Market Performance |
| Fed holds interest rate steady | Interest Rate Decision | Macroeconomic |
| Strong whale accumulation | Whale Accumulation | Whale & On-chain |

### Edge cases

- **Factor không tìm thấy trong `FACTOR_TYPE_MAP`**: Bị bỏ qua hoàn toàn (không tạo bit nào).
- **Nhiều factors map sang cùng 1 event type**: typeVec vẫn chỉ bật 1 bit (binary, không count).
- **Nhiều factors thuộc cùng 1 group**: groupVec vẫn chỉ bật 1 bit.

### Taxonomy Structure

```
13 Groups
├── Regulation & Legal (5 types)
│   ├── Regulatory Announcement
│   ├── Enforcement Action
│   ├── Legislation Progress
│   ├── Government Stance
│   └── International Sanctions or Bans
├── Macroeconomic (4 types)
│   ├── Interest Rate Decision
│   ├── Inflation Data
│   ├── Dollar Index Movement
│   └── Quantitative Easing or Tightening
├── Industry Standards & Opinions (3 types)
├── Protocol & Product (7 types)
├── Technology & Development (6 types)
├── Exchange & Trading (8 types)
├── DeFi & Ecosystem (3 types)
├── Whale & On-chain (4 types)
├── Key Figures (3 types)
├── Market Performance (6 types)
├── TradFi Crossover (4 types)
├── Partnership & Adoption (4 types)
└── Risk & Warning (5 types)
    = 62 event types tổng cộng
```

---

## Bước 2: Binary Event Vectors

**Ref: StockMem Section 3.3, Formulas (3) và (4)**
**File: `src/taxonomy.ts` — `buildTypeVector()`, `buildGroupVector()`**

### Formula (3) — typeVec (62 dimensions)

Mỗi dimension tương ứng với 1 event type. Giá trị = 1 nếu ngày đó có event type đó, 0 nếu không.

```
V_t[m] = { 1  nếu ngày t có ít nhất 1 factor thuộc event type m
          { 0  nếu không
```

**Ví dụ**: Với 3 factors ở trên:

```
Chỉ số:  0  1  2  3  ... 14 ... 33 ... 44 ... 61
Giá trị: 0  0  0  0  ...  1 ...  1 ...  1 ...  0
                         │      │      │
                         │      │      └── ETF Flow (index 44)
                         │      └── Whale Accumulation (index 33)
                         └── Interest Rate Decision (index 14)

→ typeVec = [0, 0, 0, ..., 1, ..., 1, ..., 1, ..., 0]  (62 phần tử, 3 bits = 1)
```

### Formula (4) — groupVec (13 dimensions)

Mỗi dimension tương ứng với 1 group. Giá trị = 1 nếu group có ít nhất 1 event type xuất hiện.

```
G_t[g] = { 1  nếu group g có ít nhất 1 event type active
          { 0  nếu không
```

**Ví dụ**:

```
Index:  0  1  2  3  4  5  6  7  8  9  10 11 12
Group:  R  M  I  P  T  E  D  W  K  MP TF PA RW
Value:  0  1  0  0  0  0  0  1  0  1  0  0  0
           │                    │     │
           │                    │     └── Market Performance (ETF Flow)
           │                    └── Whale & On-chain (Whale Accumulation)
           └── Macroeconomic (Interest Rate Decision)

→ groupVec = [0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0]  (13 phần tử, 3 bits = 1)
```

### Tại sao dùng binary thay vì count?

Theo paper StockMem, binary encoding đủ để capture sự **hiện diện** của sự kiện. Số lượng factors thuộc cùng 1 type không quan trọng bằng việc type đó **có xảy ra hay không** trong ngày.

---

## Bước 3: Numerical Extraction + Z-score Normalization

**Ref: History Rhymes (Khanna, 2024) — numerical indicators**
**File: `src/vectorize.ts` — `extractNumerical()`, `zScoreNormalize()`, `computeNormStats()`**

### 3a. Trích xuất 5 numerical indicators

```typescript
numeric = [msi, rsi, sentiment_score_avg, fear_greed_index, price_change_pct]
```

| Chỉ số | Trường | Phạm vi gốc | Ý nghĩa |
|--------|--------|-------------|---------|
| 0 | msi | 0-100 | Chỉ số sức mạnh thị trường |
| 1 | rsi | 0-100 | Chỉ số sức mạnh tương đối |
| 2 | sentiment_score_avg | -1 đến 1 | Tâm lý thị trường trung bình |
| 3 | fear_greed_index | 0-100 | Chỉ số sợ hãi & tham lam |
| 4 | price_change_pct | ~-20 đến +20 | % thay đổi giá |

### 3b. Z-score Normalization

Vấn đề: các chỉ số có scale khác nhau (sentiment: -1→1, rsi: 0→100, pct: -20→+20). Cần normalize để có cùng scale.

```
z_i = (x_i - μ_i) / σ_i
```

Trong đó:
- `μ_i` = trung bình của chỉ số i trên toàn bộ corpus
- `σ_i` = độ lệch chuẩn của chỉ số i trên toàn bộ corpus

**Tính từ toàn bộ corpus** (không phải từ query):

```typescript
// Tích lũy stats khi index data
for (const day of allDays) {
  const nums = [day.msi, day.rsi, day.sentiment, day.fgi, day.pct_change];
  for (i = 0..4) {
    sum[i] += nums[i];
    sumSq[i] += nums[i] * nums[i];
  }
  count++;
}

// Khi vectorize:
mean[i] = sum[i] / count;
variance[i] = sumSq[i] / count - mean[i]²;
std[i] = √variance[i];
z[i] = (x[i] - mean[i]) / std[i];
```

**Ví dụ**: Nếu corpus có `μ(rsi) = 50`, `σ(rsi) = 15`:
- RSI = 65 → z = (65-50)/15 = +1.0 (trên trung bình 1 std)
- RSI = 35 → z = (35-50)/15 = -1.0 (dưới trung bình 1 std)

### 3c. Scale với α = 0.5

**Ref: History Rhymes — α = 0.5 cho numerical weight**

```
scaled_numeric[i] = α × z_normalized[i]  (α = 0.5)
```

Vai trò của α:
- α = 0.5 giảm ảnh hưởng của numerical so với binary vectors
- Binary vectors (75d) chiếm ~94% dimensions, numerical (5d) chiếm ~6%
- Nhưng sau z-score, numerical có magnitude ~1-3, trong khi binary = 0 hoặc 1
- α = 0.5 cân bằng lại: numerical magnitude giảm xuống ~0.5-1.5

---

## Bước 4: Concat + L2-Normalize

**Ref: History Rhymes — `[features; α × numerical] → L2-normalize → inner product`**
**File: `src/vectorize.ts` — `vectorize()`, `l2Normalize()`**

### 4a. Concat

Nối 3 phần thành 1 vector 80 dimensions:

```
joint_vec = [ typeVec(62d) ; groupVec(13d) ; scaled_numeric(5d) ]
             ├── index 0-61 ──┤├── 62-74 ──┤├── 75-79 ──────────┤
```

**Ví dụ cụ thể** (giản lược):

```
typeVec:        [0, 0, ..., 1, ..., 1, ..., 1, ..., 0]     (62d, 3 bits bật)
groupVec:       [0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0]   (13d, 3 bits bật)
scaled_numeric: [0.42, 0.51, 0.36, 0.65, 0.82]             (5d, α × z-score)

concat = [0, 0, ..., 1, ..., 1, ..., 1, ..., 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0.42, 0.51, 0.36, 0.65, 0.82]
          ╰──────────── typeVec (62) ──────────────╯╰──── groupVec (13) ────╯╰──── α × numeric (5) ────╯
```

### 4b. L2-Normalize

Đưa vector về unit sphere (độ dài = 1):

```
‖v‖₂ = √(v₁² + v₂² + ... + v₈₀²)

joint_vec_normalized[i] = joint_vec[i] / ‖joint_vec‖₂
```

**Tại sao cần L2-normalize?**

Khi tất cả vectors nằm trên unit sphere (‖v‖ = 1):

```
inner_product(a, b) = Σᵢ aᵢ × bᵢ = cosine_similarity(a, b)
```

Vì `cosine(a, b) = dot(a, b) / (‖a‖ × ‖b‖)`, và `‖a‖ = ‖b‖ = 1`.

Điều này cho phép dùng **inner product** (nhanh) thay vì tính cosine (chậm hơn do phải chia norm).

**Ví dụ**:

```
Trước L2-norm:  ‖v‖₂ = √(1² + 1² + 1² + 1² + 1² + 1² + 0.42² + 0.51² + 0.36² + 0.65² + 0.82²)
                      = √(6 + 0.176 + 0.260 + 0.130 + 0.423 + 0.672)
                      = √7.661
                      ≈ 2.768

Sau L2-norm:    mỗi phần tử chia cho 2.768
                1/2.768 ≈ 0.361  (binary bits)
                0.42/2.768 ≈ 0.152  (numerical)
```

Output: `joint_vec` — mảng 80 số thực, tổng bình phương = 1.0

---

## Bước 5: Similarity Search — DailySim

**Ref: History Rhymes — inner product trên L2-normalized vectors**
**File: `src/search.ts` — `searchTopK()`**

### Thuật toán

```
DailySim(A, B) = inner_product(joint_vecA, joint_vecB)
               = Σᵢ₌₁⁸⁰ joint_vecA[i] × joint_vecB[i]
```

### Quy trình

```
1. Nhận query joint_vec (80d, đã L2-normalize)

2. Brute-force qua toàn bộ records trong database:
   for each record in database:
     candidate_vec = parse(record.joint_vec)    // 80d, đã L2-normalize từ lúc index
     score = inner_product(query_vec, candidate_vec)
     scored_list.push({ score, record })

3. Sort scored_list theo score giảm dần

4. Trả về top-K results (default K=5)
```

### Ý nghĩa score

| Score | Ý nghĩa |
|------|---------|
| 1.0 | Hoàn toàn giống nhau (cùng factors + cùng numerical values) |
| 0.7 - 0.9 | Rất giống (nhiều factors chung, numerical gần nhau) |
| 0.4 - 0.7 | Khá giống (một số factors chung) |
| 0.1 - 0.4 | Ít giống (vài factors chung hoặc chỉ numerical gần) |
| ~0.0 | Không liên quan |
| < 0 | Pattern ngược lại (hiếm với binary vectors) |

### Độ phức tạp

- **Time**: O(N × D) với N = số records, D = 80 dimensions
- **Space**: O(N × D) lưu trữ vectors
- Brute-force phù hợp cho dataset ~1000-10000 records (milliseconds)

---

## Bước 6: Window Search — SeqSim

**Ref: StockMem Section 3.3, Formula (8)**
**File: `src/search.ts` — `searchTopKWindows()`**

### Formula (8)

```
SeqSim(Q, C) = (1/W) × Σₖ₌₁ᵂ DailySim(Q[W-k], C[W-k])
```

Trong đó:
- `Q` = query window (W ngày liên tiếp)
- `C` = candidate window (W ngày liên tiếp)
- `W` = kích thước window (mặc định 5)
- `Q[W-k]` và `C[W-k]` = aligned từ cuối (ngày cuối khớp ngày cuối)

### Quy trình chi tiết

```
Input: queryVecs = [qVec₁, qVec₂, qVec₃, qVec₄, qVec₅]  (5 joint vectors đã L2-norm)
          queryStartDate = "2024-03-10"  (ngày đầu tiên của query window)
          K = 5 (top-K)

1. Sliding window qua toàn bộ records:
   for i = 0 to (N - W):
     candidate = records[i .. i+W]    // W=5 ngày liên tiếp

     2. Temporal exclusion:
        if candidate[W-1].date >= queryStartDate:
          skip    // candidate phải nằm TRƯỚC query

     3. Tính SeqSim (aligned from end):
        dailyScores = []
        totalSim = 0
        for k = 0 to W-1:
          sim = inner_product(queryVecs[W-1-k], candidateVecs[W-1-k])
          dailyScores[W-1-k] = sim
          totalSim += sim

        seqSim = totalSim / W

     4. scored_list.push({ seqSim, dailyScores, candidateWindow })

5. Sort scored_list theo seqSim giảm dần

6. Trả về top-K
```

### Aligned from end — Giải thích

"Aligned from end" nghĩa là so sánh ngày cuối cùng với ngày cuối cùng, ngày áp cuối với ngày áp cuối:

```
Query window:     [Q₁, Q₂, Q₃, Q₄, Q₅]
                    │   │   │   │   │
                    ▼   ▼   ▼   ▼   ▼
Candidate window: [C₁, C₂, C₃, C₄, C₅]

DailySim pairs:
  k=0: Q[4] ↔ C[4]  (ngày cuối = gần nhất)      → dailyScores[4]
  k=1: Q[3] ↔ C[3]  (ngày áp cuối)              → dailyScores[3]
  k=2: Q[2] ↔ C[2]                               → dailyScores[2]
  k=3: Q[1] ↔ C[1]                               → dailyScores[1]
  k=4: Q[0] ↔ C[0]  (ngày đầu = xa nhất)        → dailyScores[0]

SeqSim = (dailyScores[0] + dailyScores[1] + dailyScores[2] + dailyScores[3] + dailyScores[4]) / 5
```

### Temporal exclusion — Tại sao cần?

Tránh **data leakage**: nếu query là 5 ngày gần nhất, ta không muốn candidate overlap với query (vì chính nó sẽ match 100%).

```
Timeline: ──────[C₁C₂C₃C₄C₅]──────────────[Q₁Q₂Q₃Q₄Q₅]──
                                              │
                              queryStartDate ──┘
                    ↑
           candidate[4].date < queryStartDate → OK
```

Điều kiện: `candidate[W-1].date < queryStartDate` (ngày cuối của candidate phải trước ngày đầu của query).

### Ví dụ tính SeqSim

```
Query window (2024-03-10 → 2024-03-14):
  Q₁ = vectorize(2024-03-10) → qVec₁
  Q₂ = vectorize(2024-03-11) → qVec₂
  Q₃ = vectorize(2024-03-12) → qVec₃
  Q₄ = vectorize(2024-03-13) → qVec₄
  Q₅ = vectorize(2024-03-14) → qVec₅

Candidate window (2023-06-15 → 2023-06-19):
  C₁ = vectorize(2023-06-15) → cVec₁
  C₂ = vectorize(2023-06-16) → cVec₂
  C₃ = vectorize(2023-06-17) → cVec₃
  C₄ = vectorize(2023-06-18) → cVec₄
  C₅ = vectorize(2023-06-19) → cVec₅

DailySim computations:
  dailyScores[4] = inner_product(qVec₅, cVec₅) = 0.7408
  dailyScores[3] = inner_product(qVec₄, cVec₄) = 0.7245
  dailyScores[2] = inner_product(qVec₃, cVec₃) = 0.7102
  dailyScores[1] = inner_product(qVec₂, cVec₂) = 0.6534
  dailyScores[0] = inner_product(qVec₁, cVec₁) = 0.5921

SeqSim = (0.5921 + 0.6534 + 0.7102 + 0.7245 + 0.7408) / 5 = 0.6842
```

---

## Tóm tắt: Đoạn nào ref paper nào?

```
┌────────────────────────────────────────────────────────────────────────┐
│                         PROCESSING FLOW                                │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Bước 1: Factor → Type → Group          ◄── StockMem Sec 3.3, App A  │
│  Bước 2: typeVec(62d) + groupVec(13d)   ◄── StockMem Formulas (3)(4) │
│  Bước 3: numeric z-score + α=0.5        ◄── History Rhymes α=0.5     │
│  Bước 4: concat + L2-normalize          ◄── History Rhymes method     │
│  Bước 5: inner product search            ◄── History Rhymes metric    │
│  Bước 6: SeqSim = avg DailySim (W=5)    ◄── StockMem Formula (8)     │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  StockMem đóng góp:                                                    │
│    - Event taxonomy (13 groups × 62 types)                            │
│    - Binary encoding (typeVec + groupVec)                             │
│    - Window search SeqSim formula                                      │
│    - Temporal exclusion                                                │
│                                                                        │
│  History Rhymes đóng góp:                                              │
│    - Concat features + numerical approach                             │
│    - α = 0.5 numerical weight                                         │
│    - L2-normalize → inner product = cosine                            │
│    - Z-score normalization cho numerical                               │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```
