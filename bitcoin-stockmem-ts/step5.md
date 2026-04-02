# Step 5 — Truy xuất lịch sử tương tự (Historical Sequence Retrieval)

## Tổng quan

Step 5 tìm trong lịch sử những **chuỗi sự kiện giống nhất** với tình hình hiện tại, kèm theo reflection (kinh nghiệm phân tích) tương ứng. Giống như một nhà phân tích nhớ lại: *"Tình huống này giống hồi tháng 1 — lúc đó cũng có ETF + CPI tốt, giá đã tăng 5%."*

**Tương ứng bài báo:** Mục 3.3 Retrieval, công thức (3)-(10), dùng `LLM_retrieve`

**Chiến lược 2 giai đoạn:** Sàng lọc thô bằng Jaccard + LLM phán đoán tinh

```
Chuỗi sự kiện hiện tại [t-5, t]
         │
         │  Giai đoạn 1: Jaccard trên binary vectors
         │  (nhanh, không cần LLM)
         v
    Top-10 chuỗi lịch sử ứng viên
         │
         │  Giai đoạn 2: LLM lọc tinh
         │  (chính xác, chỉ xử lý 10 ứng viên)
         v
    3-5 chuỗi thực sự tương tự
         │
         │  Lấy reflection tương ứng
         v
    Kinh nghiệm lịch sử -> gửi cho Step 6
```

---

## Các file liên quan

| File | Vai trò |
|------|---------|
| `src/pipeline/step5-retrieve.ts` | Logic chính: 2 giai đoạn truy xuất |
| `src/memory/similarity.ts` | Jaccard similarity, binary vectors, `findTopKSequences()` |
| `src/memory/event-memory.ts` | `buildEventSeries()`, `computeAndStoreDailyVectors()` |
| `src/memory/reflection-memory.ts` | `getReflectionByWindow()`, `formatReflectionsForPrompt()` |
| `src/llm/prompts.ts` | Prompt template (`RETRIEVE_PROMPT`) |
| `src/llm/response-parser.ts` | Validate JSON (`RetrieveResultSchema`) |
| `src/data/taxonomy.ts` | `TYPE_TO_INDEX`, `GROUP_TO_INDEX` — map tên sang chỉ mục (index) |
| `src/storage/database.ts` | Đọc `merged_events`, `daily_vectors`, `reflections` |
| `src/config.ts` | `WINDOW_SIZE=5`, `ALPHA=0.7`, `TOP_K_RETRIEVE=10`, `NUM_TYPES=56`, `NUM_GROUPS=13` |

---

## Đầu vào

- **Chuỗi sự kiện hiện tại:** ngày [t-5, t] cho asset cụ thể
- **Toàn bộ lịch sử sự kiện:** mọi ngày trước t-5
- **Reflection memory:** bảng `reflections` từ Step 4

---

## Giai đoạn 1: Sàng lọc thô bằng Jaccard (Coarse Screening)

### Bước 1.1: Tạo binary vectors (véc-tơ nhị phân) cho mỗi ngày

```ts
computeAndStoreDailyVectors(ds, asset);
```

Hàm này gọi `storeDailyVector()` trong `similarity.ts`:

```ts
function storeDailyVector(date, asset, events) {
  const types = events.map((e) => e.event_type);
  const groups = events.map((e) => e.event_group);
  const tv = buildTypeVector(types);    // 56 chiều
  const gv = buildGroupVector(groups);  // 13 chiều
  // Lưu vào bảng daily_vectors
}
```

**Type vector (véc-tơ loại) — 56 chiều:**
```ts
function buildTypeVector(eventTypes: string[]): number[] {
  const v = new Array(NUM_TYPES).fill(0);   // [0, 0, 0, ..., 0] (56 phần tử)
  for (const t of eventTypes) {
    const idx = TYPE_TO_INDEX.get(t);       // tìm chỉ mục của loại sự kiện
    if (idx !== undefined) v[idx] = 1;      // đánh dấu = 1
  }
  return v;
}
```

**Group vector (véc-tơ nhóm) — 13 chiều:**
```ts
function buildGroupVector(eventGroups: string[]): number[] {
  const g = new Array(NUM_GROUPS).fill(0);  // [0, 0, 0, ..., 0] (13 phần tử)
  for (const grp of eventGroups) {
    const idx = GROUP_TO_INDEX.get(grp);
    if (idx !== undefined) g[idx] = 1;
  }
  return g;
}
```

**Ví dụ:** Ngày 2025-03-20 có sự kiện:
- "Regulatory Announcement" (index=0 trong type, group "Regulation & Legal" index=0)
- "Interest Rate Decision" (index=5 trong type, group "Macroeconomic" index=1)
- "Whale Accumulation" (index=30 trong type, group "Whale & On-chain" index=7)

```
type_vector  = [1, 0, 0, 0, 0, 1, 0, ..., 1, ..., 0]  (56 chiều, 3 vị trí = 1)
group_vector = [1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0] (13 chiều, 3 vị trí = 1)
```

Lưu vào bảng `daily_vectors`:
```sql
INSERT OR REPLACE INTO daily_vectors (date, asset, type_vector, group_vector, event_count)
VALUES (?, ?, ?, ?, ?)
```

### Bước 1.2: Tính Jaccard similarity (độ tương đồng Jaccard)

**Jaccard** đo mức trùng lặp giữa 2 tập hợp:

```ts
function jaccard(a: number[], b: number[]): number {
  let intersection = 0;  // giao (cả hai đều = 1)
  let union = 0;         // hợp (ít nhất một cái = 1)
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) union++;
    if (a[i] && b[i]) intersection++;
  }
  return union === 0 ? 0 : intersection / union;
}
```

**Ví dụ:**
```
type_vec_A = [1, 0, 1, 0, 0, 1]    (có type 0, 2, 5)
type_vec_B = [1, 1, 1, 0, 0, 0]    (có type 0, 1, 2)
intersection = 2  (type 0 và type 2)
union = 4         (type 0, 1, 2, 5)
Jaccard = 2/4 = 0.5
```

### Bước 1.3: Tính DailySim (độ tương đồng hàng ngày)

**Công thức (7) trong bài báo:**
```
DailySim(t_i, t_j) = α × Jaccard(V_ti, V_tj) + (1 - α) × Jaccard(G_ti, G_tj)
```

```ts
function dailySim(tv1, gv1, tv2, gv2, alpha = ALPHA) {
  return alpha * jaccard(tv1, tv2) + (1 - alpha) * jaccard(gv1, gv2);
}
```

- `α = 0.7`: type (loại cụ thể) chiếm 70% trọng số — quan trọng hơn
- `1 - α = 0.3`: group (nhóm rộng) chiếm 30% trọng số — bổ sung context

**Tại sao dùng cả 2 cấp?**
- 2 ngày có cùng group (VD: đều có "Regulation") nhưng khác type (ngày A có "Enforcement Action", ngày B có "Government Stance") -> DailySim thấp vì type chiếm 70%
- 2 ngày có cùng type -> DailySim cao vì trùng cả 2 cấp

### Bước 1.4: Tính SeqSim (độ tương đồng chuỗi)

**Công thức (8) trong bài báo:**
```
SeqSim(Series_a, Series_b) = (1/w) × Σ DailySim(t_{a-k}, t_{b-k})  với k = 0..w-1
```

```ts
function seqSim(seriesA, seriesB) {
  const w = Math.min(seriesA.length, seriesB.length);
  let total = 0;
  for (let k = 0; k < w; k++) {
    const a = seriesA[seriesA.length - 1 - k];  // so sánh từ cuối ngược lại
    const b = seriesB[seriesB.length - 1 - k];
    total += dailySim(a.typeVec, a.groupVec, b.typeVec, b.groupVec);
  }
  return total / w;   // trung bình
}
```

**Quan trọng:** So sánh theo **thứ tự thời gian căn phải** (aligned from the end) — ngày cuối của chuỗi A so với ngày cuối chuỗi B, ngày áp cuối so ngày áp cuối, v.v. Đảm bảo sự kiện gần nhất (ảnh hưởng lớn nhất) được so khớp chính xác.

### Bước 1.5: Tìm Top-K chuỗi lịch sử

```ts
function findTopKSequences(currentDates, allHistoryDates, asset, k = 10) {
  const w = currentDates.length;
  const currentSeries = loadSeriesVectors(currentDates, asset);
  const candidates = [];

  // Sliding window (cửa sổ trượt) qua toàn bộ lịch sử
  for (let i = 0; i <= allHistoryDates.length - w; i++) {
    const histDates = allHistoryDates.slice(i, i + w);
    if (histDates[histDates.length - 1] >= currentDates[0]) continue;
    //                                     ^^^^^^^^^^^^^^^^^
    //        Bỏ qua chuỗi chồng lấn với thời gian hiện tại
    const histSeries = loadSeriesVectors(histDates, asset);
    const sim = seqSim(currentSeries, histSeries);
    candidates.push({ dates: histDates, score: sim });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, k);  // lấy Top-K
}
```

**Cửa sổ trượt (sliding window):** dịch chuyển cửa sổ w ngày qua toàn bộ lịch sử, tính SeqSim cho mỗi vị trí, lấy K chuỗi có điểm cao nhất.

**Điều kiện lọc:** `histDates[cuối] >= currentDates[đầu]` -> bỏ qua. Đảm bảo không dùng dữ liệu tương lai (data leakage — rò rỉ dữ liệu).

---

## Giai đoạn 2: Phán đoán tinh bằng LLM (Fine-Grained Judgment)

### Bước 2.1: Chuẩn bị dữ liệu ứng viên

Với mỗi chuỗi ứng viên từ giai đoạn 1, xây dựng text mô tả:

```ts
for (const [i, seq] of topSeqs.entries()) {
  // Tìm reflection tương ứng cho chuỗi lịch sử này
  let ref = getReflectionByWindow(seq.dates[seq.dates.length - 1], asset);
  if (!ref) {
    const other = asset === "BTC" ? "ETH" : "BTC";
    ref = getReflectionByWindow(seq.dates[seq.dates.length - 1], other);
    //                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //   Fallback: nếu không có reflection cho BTC, thử lấy ETH (và ngược lại)
  }

  // Xây dựng chuỗi sự kiện lịch sử
  const { dates: hDates, eventsPerDay: hEvents } = buildEventSeries(
    seq.dates[seq.dates.length - 1], WINDOW_SIZE, asset
  );
  const hText = formatSeriesForPrompt(hDates, hEvents);

  let entry = `--- Candidate ${i} (similarity: ${seq.score.toFixed(3)}) ---`;
  entry += `Period: ${seq.dates[0]} to ${seq.dates[seq.dates.length - 1]}`;
  entry += hText;
  if (ref) {
    entry += `Outcome: price went ${ref.price_direction}`;
    entry += `Analysis: ${ref.reason.slice(0, 300)}`;
  }
}
```

Mỗi ứng viên bao gồm:
- Điểm similarity (Jaccard)
- Khoảng thời gian
- Chuỗi sự kiện chi tiết
- Kết quả giá thực tế + phân tích từ reflection (nếu có)

### Bước 2.2: Gọi LLM lọc

**Prompt:**
```
You are comparing cryptocurrency event sequences to determine which
historical patterns are truly analogous to the current market situation.

Current event sequence (past 5 days) for BTC:
=== 2025-03-16 ===
  [Macroeconomic / Inflation Data] US CPI drops to 2.5%
  ...

Candidate historical sequences (with their subsequent market outcomes):

--- Candidate 0 (similarity: 0.782) ---
Period: 2025-01-10 to 2025-01-15
=== 2025-01-10 ===
  [Macroeconomic / Interest Rate Decision] Fed signals rate cut
  ...
Outcome: price went up
Analysis: BTC rose due to dovish Fed stance combined with...

--- Candidate 1 (similarity: 0.756) ---
Period: 2025-02-05 to 2025-02-10
  ...

For each candidate, judge whether it represents a genuinely analogous market
situation that provides useful reference for predicting the current outcome.

Output JSON:
{"selected_indices": [<list of 0-based candidate indices that are valid references>]}
```

**LLM phân tích:** Không chỉ dựa vào Jaccard score mà còn xem nội dung sự kiện có thực sự tương đồng không:
- Candidate 0: cùng có CPI tốt + động thái tích cực từ Fed -> **chọn**
- Candidate 1: tuy Jaccard cao nhưng bối cảnh khác (có hack lớn) -> **bỏ**

**Kết quả:**
```json
{"selected_indices": [0, 3, 7]}
```

**Validate bằng Zod:**
```ts
const RetrieveResultSchema = z.object({
  selected_indices: z.array(z.number()),  // danh sách index ứng viên được chọn
});
```

**Fallback khi LLM thất bại:**
```ts
catch {
  selectedIndices = Array.from({ length: Math.min(3, topSeqs.length) }, (_, i) => i);
  //                                                                    ^^^^^^^^
  //              Nếu LLM thất bại -> lấy 3 ứng viên đầu (điểm cao nhất)
}
```

### Bước 2.3: Thu thập reflection tương ứng

```ts
const reflections = [];
const refIds = [];
for (const idx of selectedIndices) {
  const ref = candidateReflections[idx];
  if (ref) {
    reflections.push(ref);
    refIds.push(ref.id);
  }
}
```

---

## Đầu ra chi tiết

Hàm `retrieveReferences()` trả về:

```ts
{
  reflections: Record<string, any>[];  // danh sách reflection từ chuỗi lịch sử được chọn
  refIds: number[];                    // danh sách ID reflection tương ứng
}
```

Mỗi reflection chứa:
- `price_direction` — giá đã lên hay xuống trong tình huống tương tự
- `reason` — lý do giá biến động
- `key_events` — sự kiện then chốt
- `window_start`, `window_end` — khoảng thời gian

Đầu ra này được Step 6 format thành text bằng `formatReflectionsForPrompt()`:

```
--- Historical Reference 1 ---
Period: 2025-01-10 to 2025-01-15
Actual price movement: up
Analysis: BTC rose due to dovish Fed stance combined with ETF inflows...
Key events: Fed rate signal; BlackRock ETF inflow; CPI below expectations

--- Historical Reference 2 ---
Period: 2024-11-20 to 2024-11-25
Actual price movement: up
Analysis: ...
```

---

## Bảng `daily_vectors` trong SQLite

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `date` | TEXT | Ngày (khoá chính cùng `asset`) |
| `asset` | TEXT | Tài sản (khoá chính cùng `date`) |
| `type_vector` | TEXT | JSON array 56 phần tử (0 hoặc 1) |
| `group_vector` | TEXT | JSON array 13 phần tử (0 hoặc 1) |
| `event_count` | INTEGER | Số sự kiện trong ngày |

---

## Ví dụ minh hoạ đầy đủ

**Hiện tại:** BTC, ngày 2025-03-20, chuỗi [15/3 — 20/3]

**Giai đoạn 1 (Jaccard) tìm được Top-10:**

| Hạng | Khoảng thời gian | SeqSim | Đặc điểm chính |
|------|-----------------|--------|----------------|
| 0 | 01/10 — 01/15 | 0.782 | CPI tốt + ETF approval |
| 1 | 02/05 — 02/10 | 0.756 | CPI tốt + nhưng có hack lớn |
| 2 | 12/01 — 12/06 | 0.734 | Fed dovish + institutional adoption |
| ... | ... | ... | ... |
| 9 | 08/15 — 08/20 | 0.621 | Regulation + macro |

**Giai đoạn 2 (LLM) lọc còn 3:**

```json
{"selected_indices": [0, 2, 5]}
```

- Chọn 0: CPI tốt + ETF -> rất giống hiện tại
- Bỏ 1: có hack lớn -> bối cảnh khác
- Chọn 2: Fed dovish + institutional adoption -> tương tự
- Chọn 5: regulation tương tự
- Bỏ các ứng viên còn lại

**Đầu ra:** 3 reflection kèm phân tích + kết quả giá -> gửi cho Step 6.

---

## Xử lý lỗi

| Tình huống | Cách xử lý |
|-----------|------------|
| Lịch sử quá ngắn (< window ngày) | Trả về `{ reflections: [], refIds: [] }` |
| Không tìm được chuỗi tương tự nào | Trả về rỗng |
| Không có reflection cho chuỗi lịch sử | Thử asset khác (BTC ↔ ETH), nếu vẫn không có thì bỏ qua chuỗi đó |
| LLM lọc thất bại | Fallback: lấy 3 ứng viên đầu tiên (Jaccard score cao nhất) |

---

## Mối liên kết với các bước khác

| Bước | Mối quan hệ |
|------|-------------|
| **Step 2 -> Step 5** | Step 5 đọc `merged_events` để tạo binary vectors và xây dựng chuỗi sự kiện |
| **Step 3 -> Step 5** | Chuỗi sự kiện chứa `delta_info` từ Step 3 (khi format cho LLM) |
| **Step 4 -> Step 5** | Step 5 đọc `reflections` từ Step 4 để lấy kinh nghiệm lịch sử |
| **Step 5 -> Step 6** | Step 6 nhận reflections từ Step 5 làm "Historical Reference Experience" |

Step 5 là **cầu nối** giữa bộ nhớ (Event Memory + Reflection Memory) và bước dự đoán cuối cùng.
