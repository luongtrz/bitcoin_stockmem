# Step 6 — Dự đoán cuối cùng (Final Prediction)

## Tổng quan

Step 6 là bước cuối cùng, **tổng hợp mọi thông tin từ 5 bước trước** để đưa ra dự đoán giá ngày mai: **lên (up)** hay **xuống (down)**. LLM đóng vai nhà phân tích chuyên nghiệp, kết hợp 3 nguồn thông tin: chuỗi sự kiện gần đây, thông tin gia tăng (ΔInfo), và kinh nghiệm lịch sử tương tự.

**Tương ứng bài báo:** Mục 3.4 Inference, công thức (11), dùng `LLM_predict`

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                    3 nguồn thông tin đầu vào                    │
 │                                                                 │
 │  ① Series_current          ② ΔInfo            ③ Reflection_ref │
 │  (chuỗi sự kiện gần đây)  (thông tin gia tăng) (kinh nghiệm   │
 │  [Step 1-2]                [Step 3]             lịch sử)       │
 │                                                  [Step 4-5]     │
 └───────────────────────────┬─────────────────────────────────────┘
                             │
                             v
                    ┌─────────────────┐
                    │  LLM_predict    │
                    │  (Gemini 2.5    │
                    │   Flash)        │
                    └────────┬────────┘
                             │
                             v
                    ┌─────────────────┐
                    │  Dự đoán:       │
                    │  "up" / "down"  │
                    │  + lý do        │
                    └─────────────────┘
```

---

## Các file liên quan

| File | Vai trò |
|------|---------|
| `src/pipeline/step6-predict.ts` | Logic chính: tổng hợp + gọi LLM dự đoán |
| `src/pipeline/step5-retrieve.ts` | Gọi trực tiếp `retrieveReferences()` để lấy kinh nghiệm |
| `src/llm/prompts.ts` | Prompt template (`PREDICT_PROMPT`) |
| `src/llm/gemini-client.ts` | Client gọi Gemini API |
| `src/llm/response-parser.ts` | Validate JSON (`PredictResultSchema`) |
| `src/memory/event-memory.ts` | `buildEventSeries()`, `formatSeriesForPrompt()` |
| `src/memory/reflection-memory.ts` | `formatReflectionsForPrompt()` |
| `src/storage/database.ts` | Lưu kết quả vào bảng `predictions` |
| `src/config.ts` | `WINDOW_SIZE = 5` |

---

## Đầu vào — 3 nguồn thông tin

### ① Chuỗi sự kiện gần đây + ΔInfo (`Series_current`)

Xây dựng giống Step 4:
```ts
const { dates, eventsPerDay } = buildEventSeries(date, WINDOW_SIZE, asset);
const information = formatSeriesForPrompt(dates, eventsPerDay, true);
//                                                               ^^^^
//                                                   bao gồm ΔInfo
```

**Format mẫu:**
```
=== 2025-03-16 ===
  [Macroeconomic / Inflation Data] US CPI drops to 2.5%
    ΔInfo: Lower than expected 2.8%, signaling faster disinflation

=== 2025-03-18 ===
  [Regulation & Legal / Regulatory Announcement] SEC approves spot Bitcoin ETFs
    ΔInfo: Reversed previous postponement, exceeded market expectations

=== 2025-03-20 ===
  [Partnership & Adoption / Institutional Adoption] Goldman announces BTC custody
    ΔInfo: First major US bank, significant institutional milestone
```

Nguồn: Step 1 (trích xuất) + Step 2 (gộp) + Step 3 (ΔInfo)

### ② Kinh nghiệm lịch sử (`Reflection_ref`)

Lấy trực tiếp từ Step 5:
```ts
const { reflections, refIds } = await retrieveReferences(client, date, asset);
const histReflection = formatReflectionsForPrompt(reflections);
```

**`formatReflectionsForPrompt()` format:**
```
--- Historical Reference 1 ---
Period: 2025-01-10 to 2025-01-15
Actual price movement: up
Analysis: BTC rose due to dovish Fed stance combined with record ETF inflows
and institutional buying. The convergence of macro tailwinds and regulatory
clarity created strong bullish momentum.
Key events: Fed rate signal; BlackRock ETF inflow; CPI below expectations

--- Historical Reference 2 ---
Period: 2024-11-20 to 2024-11-25
Actual price movement: up
Analysis: Similar pattern of institutional adoption announcements following
favorable regulatory developments led to sustained price appreciation...
Key events: Fidelity custody launch; SEC guidance update; Goldman BTC desk
```

Nếu không có kinh nghiệm lịch sử nào:
```
No historical reference experience available.
```

Nguồn: Step 4 (reflection) + Step 5 (truy xuất)

### ③ Asset (tài sản)

`"BTC"` hoặc `"ETH"`

---

## Quy trình xử lý chi tiết

### Bước 1: Xây dựng chuỗi sự kiện

```ts
const { dates, eventsPerDay } = buildEventSeries(date, WINDOW_SIZE, asset);
const information = formatSeriesForPrompt(dates, eventsPerDay, true);

if (!information.trim()) {
  console.warn(`No events for prediction on ${date}/${asset}`);
  return null;  // không có sự kiện -> không thể dự đoán
}
```

### Bước 2: Lấy kinh nghiệm lịch sử (gọi Step 5)

```ts
const { reflections, refIds } = await retrieveReferences(client, date, asset);
const histReflection = formatReflectionsForPrompt(reflections);
```

Bước này chạy toàn bộ pipeline Step 5 (Jaccard + LLM lọc).

### Bước 3: Tạo prompt

```ts
const prompt = fillTemplate(PREDICT_PROMPT, {
  asset,                      // "BTC"
  information,                // chuỗi sự kiện + ΔInfo
  hist_reflection: histReflection,  // kinh nghiệm lịch sử
});
```

**Prompt đầy đủ:**

```
You are a cryptocurrency analyst specializing in BTC. You need to predict
tomorrow's price movement (up/down) based on the following analytical elements.

Analytical Elements: Recent event sequence, today's incremental information,
and relevant historical reference experience.

Logic of the Analytical Elements:

The recent event sequence outlines events within a recent time window that
may impact tomorrow's price.

Incremental information refers to new developments or changes in an event
compared to its past occurrences, indicating whether it has become more
positive/negative/neutral.

Price movements depend not only on the absolute nature of the information
(positive/negative) but also on the degree of deviation from existing market
expectations (exceeding expectations/falling short of expectations).
Incremental information reflects this deviation from market expectations.

Historical reference experience includes similar event sequence patterns
matched from historical data based on the characteristics of the current
event sequence.

=== Events and Incremental Information ===
=== 2025-03-16 ===
  [Macroeconomic / Inflation Data] US CPI drops to 2.5%
    ΔInfo: Lower than expected 2.8%, signaling faster disinflation
=== 2025-03-18 ===
  [Regulation & Legal / Regulatory Announcement] SEC approves spot Bitcoin ETFs
    ΔInfo: Reversed previous postponement, exceeded market expectations
  [Market Performance / ETF Flow] BlackRock BTC ETF sees $500M inflow
    ΔInfo: Largest single-day crypto ETF inflow ever
=== 2025-03-20 ===
  [Partnership & Adoption / Institutional Adoption] Goldman announces BTC custody
    ΔInfo: First major US bank, significant institutional milestone

=== Historical Reference Experience ===
--- Historical Reference 1 ---
Period: 2025-01-10 to 2025-01-15
Actual price movement: up
Analysis: BTC rose due to dovish Fed stance combined with record ETF inflows...
Key events: Fed rate signal; BlackRock ETF inflow; CPI below expectations

--- Historical Reference 2 ---
Period: 2024-11-20 to 2024-11-25
Actual price movement: up
Analysis: Similar pattern of institutional adoption following regulatory clarity...
Key events: Fidelity custody launch; SEC guidance update

Please refer to the historical experience and predict the price change based
on the given events and incremental information. Analyze the basis for the
price movement (within 500 words).

Output strictly in the following JSON format:
{"Reason for price movement": "...", "Price movement": "up/down"}
```

**Cấu trúc prompt — 3 phần logic:**
1. **Vai trò + hướng dẫn:** Đặt LLM vào vai nhà phân tích chuyên về asset cụ thể
2. **Giải thích logic ΔInfo:** Giúp LLM hiểu cách dùng thông tin gia tăng — không chỉ xem tin tốt/xấu mà phải xem mức độ bất ngờ
3. **Dữ liệu:** Chuỗi sự kiện + ΔInfo + kinh nghiệm lịch sử

### Bước 4: Gọi LLM và parse kết quả

```ts
const result = await client.generateJson(prompt);
const parsed = parsePredictResult(result);
```

**Validate bằng Zod:**
```ts
const PredictResultSchema = z.object({
  "Reason for price movement": z.string(),  // bắt buộc: lý do
  "Price movement": z.string(),             // bắt buộc: "up" hoặc "down"
});
```

**Kết quả mẫu từ LLM:**
```json
{
  "Reason for price movement": "Based on the convergence of multiple bullish catalysts, BTC is likely to continue rising tomorrow. The recent CPI data showing faster-than-expected disinflation (ΔInfo: 2.5% vs expected 2.8%) reduces the likelihood of further rate hikes, creating a favorable macro environment. SEC's spot ETF approval, which reversed a previous postponement (ΔInfo: exceeded expectations), has triggered unprecedented institutional demand as evidenced by BlackRock's record $500M day-one inflow. Goldman Sachs announcing BTC custody (ΔInfo: first major US bank) further legitimizes crypto as an institutional asset class. Historical references confirm this pattern: both Reference 1 (Jan 2025) and Reference 2 (Nov 2024) show that similar combinations of favorable macro + regulatory clarity + institutional adoption led to sustained price increases. The cumulative positive surprise across all ΔInfo indicators suggests the market has not yet fully priced in these developments.",

  "Price movement": "up"
}
```

### Bước 5: Chuẩn hoá hướng dự đoán

```ts
let direction = parsed["Price movement"].toLowerCase().trim();
if (!["up", "down"].includes(direction)) {
  direction = direction.includes("up") ? "up" : "down";
}
```

LLM đôi khi trả về "Up", "UP", "likely up", "slightly down" thay vì "up"/"down" chính xác. Code chuẩn hoá:
1. Chuyển thành chữ thường + bỏ khoảng trắng
2. Nếu vẫn không phải "up" hoặc "down" -> kiểm tra chứa "up" hay không -> quyết định

### Bước 6: Lưu vào cơ sở dữ liệu

```ts
const predId = insertPrediction({
  date,
  asset,
  predicted_direction: direction,
  reason: parsed["Reason for price movement"],
  reference_reflection_ids: refIds,
});
```

Lưu vào bảng `predictions`:
```sql
INSERT INTO predictions
  (date, asset, predicted_direction, actual_direction, reason,
   reference_reflection_ids, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
```

Lưu ý: `actual_direction` để null lúc dự đoán — sẽ được điền sau khi biết kết quả thực tế (dùng cho evaluation ở `src/evaluation/`).

---

## Đầu ra chi tiết

### Bảng `predictions` trong SQLite

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | INTEGER | Khoá chính, tự tăng |
| `date` | TEXT | Ngày dự đoán (dự đoán cho giá ngày t+1) |
| `asset` | TEXT | Tài sản: "BTC" hoặc "ETH" |
| `predicted_direction` | TEXT | Hướng dự đoán: "up" hoặc "down" |
| `actual_direction` | TEXT | Hướng thực tế (điền sau): "up", "down", hoặc null |
| `reason` | TEXT | Lý do dự đoán (do LLM viết, tối đa ~500 từ) |
| `reference_reflection_ids` | TEXT | JSON array ID reflection đã tham chiếu, VD: `[12, 45, 67]` |
| `created_at` | TEXT | Thời điểm tạo bản ghi |

### Giá trị trả về

Hàm `predict()` trả về:
```ts
{
  id: number;               // ID prediction trong DB
  date: string;             // "2025-03-20"
  asset: string;            // "BTC"
  predictedDirection: string; // "up"
  reason: string;           // lý do chi tiết
  refIds: number[];         // [12, 45, 67] — ID reflection đã dùng
} | null                    // null nếu thất bại
```

---

## Ví dụ minh hoạ đầy đủ

**Đầu vào:**
- asset = "BTC", date = "2025-03-20"
- Chuỗi sự kiện [15/3 — 20/3]: CPI tốt, SEC phê duyệt ETF, BlackRock inflow kỷ lục, Goldman custody
- Step 5 trả về 2 reflection tham chiếu (cả 2 đều là "up")

**Kết quả:**

| Trường | Giá trị |
|--------|---------|
| id | 42 |
| date | 2025-03-20 |
| asset | BTC |
| predicted_direction | **up** |
| actual_direction | *(null — chờ điền sau)* |
| reason | Based on the convergence of multiple bullish catalysts... |
| reference_reflection_ids | [12, 45] |

**Log:** `Prediction 42: 2025-03-20/BTC -> up`

---

## Công thức (11) trong bài báo

```
ΔP̂_{t+1} = LLM_predict(Series_current, ΔInfo_current, Reflection_ref)
```

| Ký hiệu | Ý nghĩa | Nguồn trong code |
|----------|---------|------------------|
| `ΔP̂_{t+1}` | Dự đoán hướng giá ngày mai | `predicted_direction` |
| `Series_current` | Chuỗi sự kiện gần đây [t-w, t] | `information` (từ `buildEventSeries` + `formatSeriesForPrompt`) |
| `ΔInfo_current` | Thông tin gia tăng ngày t | Nằm trong `information` (dòng `ΔInfo:`) |
| `Reflection_ref` | Kinh nghiệm lịch sử tương tự | `histReflection` (từ `retrieveReferences` + `formatReflectionsForPrompt`) |

---

## Xử lý lỗi

| Tình huống | Cách xử lý |
|-----------|------------|
| Không có sự kiện trong cửa sổ | Ghi log cảnh báo, trả về `null` |
| Step 5 (retrieval) thất bại | `histReflection` = "No historical reference experience available." — vẫn dự đoán, chỉ thiếu kinh nghiệm |
| LLM dự đoán thất bại | Ghi log cảnh báo, trả về `null` |
| LLM trả direction không hợp lệ (VD: "slightly up") | Chuẩn hoá: kiểm tra chứa "up" -> "up", ngược lại -> "down" |

---

## Sau khi dự đoán xong

### Cập nhật actual_direction (đánh giá)

Khi biết kết quả thực tế (ngày t+1 kết thúc):
1. Lấy giá close ngày t+1 so với ngày t
2. Nếu tăng > 1% -> actual = "up", giảm > 1% -> actual = "down"
3. Cập nhật bảng `predictions`

### Mở rộng bộ nhớ (giai đoạn test)

Sau khi biết kết quả thực, chạy Step 4 thêm 1 lần:
- Phân tích: chuỗi sự kiện + kết quả thực tế -> tạo reflection mới
- Lưu vào `reflections` với `source = "test"`
- Các dự đoán tiếp theo sẽ có thêm kinh nghiệm mới này

### Đánh giá hiệu suất (`src/evaluation/`)

- `metrics.ts`: tính accuracy (độ chính xác), precision (độ chính xác dương), recall (độ nhạy), F1-score, MCC (Matthews Correlation Coefficient)
- `backtest.ts`: chạy backtest (kiểm tra lại) trên toàn bộ tập test

---

## Tổng kết toàn bộ pipeline

```
Tin tức + Giá                     Kiến trúc bộ nhớ kép
    │                            ┌─────────────────────────────┐
    v                            │                             │
[Step 1] Trích xuất              │   Event Memory (bộ nhớ      │
    │                            │   sự kiện):                 │
    v                            │   - raw_events              │
[Step 2] Gộp ──────────────────> │   - merged_events           │
    │                            │   - event chains + ΔInfo    │
    v                            │   - daily_vectors           │
[Step 3] Theo dõi chuỗi ──────> │                             │
    │                            │   Reflection Memory (bộ nhớ │
    v                            │   phản chiếu):              │
[Step 4] Phản chiếu ──────────> │   - reflections             │
                                 │                             │
                                 └──────────────┬──────────────┘
                                                │
                                                v
                                 [Step 5] Truy xuất lịch sử
                                                │
                                                v
                                 [Step 6] Dự đoán -> up/down
                                                │
                                                v
                                          predictions
```

| Bước | Input | Output | LLM call |
|------|-------|--------|----------|
| Step 1 | Tin tức thô | raw_events + embedding | LLM_ext (nhiều lần/batch) |
| Step 2 | raw_events | merged_events + embedding | LLM_merge (nhiều lần/cụm) |
| Step 3 | merged_events hiện tại + lịch sử | cập nhật: prev_event_id, chain_depth, delta_info | LLM_track (nhiều lần/sự kiện) |
| Step 4 | chuỗi sự kiện + giá thực tế | reflections | LLM_reason (1 lần) |
| Step 5 | chuỗi hiện tại + lịch sử | reflections tham chiếu | LLM_retrieve (1 lần) |
| Step 6 | chuỗi + ΔInfo + reflections | predictions (up/down + lý do) | LLM_predict (1 lần) |
