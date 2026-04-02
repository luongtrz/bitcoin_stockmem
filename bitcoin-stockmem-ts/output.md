# Output — Đầu ra của hệ thống

## Tổng quan

Hệ thống Bitcoin StockMem tạo ra **2 nhóm đầu ra chính**: kết quả dự đoán (predictions) và kết quả đánh giá (evaluation metrics). Ngoài ra, toàn bộ tri thức trung gian (sự kiện, chuỗi, reflection) cũng được lưu lại trong SQLite và có thể truy xuất.

```
Pipeline 6 bước
      │
      ├──> Đầu ra chính: predictions (dự đoán up/down + lý do)
      │
      ├──> Đầu ra đánh giá: accuracy, MCC
      │
      └──> Đầu ra trung gian (tri thức tích luỹ):
           ├── raw_events        (sự kiện thô)
           ├── merged_events     (sự kiện đã gộp + chuỗi + ΔInfo)
           ├── daily_vectors     (véc-tơ nhị phân cho Jaccard)
           └── reflections       (kinh nghiệm phân tích)
```

---

## 1. Đầu ra chính — Predictions (Dự đoán)

### Bảng `predictions` trong SQLite

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | INTEGER | Khoá chính, tự tăng |
| `date` | TEXT | Ngày thực hiện dự đoán (dự đoán cho giá ngày t+1) |
| `asset` | TEXT | Tài sản: `"BTC"` hoặc `"ETH"` |
| `predicted_direction` | TEXT | Hướng giá dự đoán: `"up"` hoặc `"down"` |
| `actual_direction` | TEXT | Hướng giá thực tế (điền sau khi biết): `"up"`, `"down"`, hoặc `null` |
| `reason` | TEXT | Lý do dự đoán do LLM viết (~500 từ) |
| `reference_reflection_ids` | TEXT | JSON array ID reflection đã tham chiếu, VD: `[12, 45, 67]` |
| `created_at` | TEXT | Thời điểm tạo bản ghi |

### Giá trị trả về từ hàm `predict()`

```ts
{
  id: number;                 // 42
  date: string;               // "2025-03-20"
  asset: string;              // "BTC"
  predictedDirection: string; // "up"
  reason: string;             // "Based on the convergence of multiple..."
  refIds: number[];           // [12, 45] — ID reflection đã dùng
} | null                      // null nếu không đủ dữ liệu hoặc LLM thất bại
```

### Ví dụ bản ghi prediction

```
id:                       42
date:                     2025-03-20
asset:                    BTC
predicted_direction:      up
actual_direction:         up        (điền sau)
reason:                   Based on the convergence of multiple bullish
                          catalysts: CPI below expectations creating
                          risk-on environment, SEC ETF approval exceeding
                          market expectations, record BlackRock ETF inflow,
                          and Goldman Sachs BTC custody announcement.
                          Historical references with similar patterns
                          (Jan 2025, Nov 2024) both resulted in price
                          increases. ΔInfo consistently positive across
                          all events.
reference_reflection_ids: [12, 45]
created_at:               2025-03-20 14:30:22
```

---

## 2. Đầu ra đánh giá — Evaluation Metrics (Chỉ số đánh giá)

### File: `src/evaluation/metrics.ts`

Hai chỉ số chính:

### Accuracy (Độ chính xác)

```ts
function accuracy(predictions: string[], actuals: string[]): number {
  const correct = predictions.filter((p, i) => p === actuals[i]).length;
  return correct / predictions.length;
}
```

**Công thức:** `Accuracy = số dự đoán đúng / tổng số dự đoán`

**Ví dụ:** 100 ngày dự đoán, 58 lần đúng -> Accuracy = 0.58 (58%)

**Ý nghĩa:** Tỷ lệ dự đoán đúng hướng giá. Trên 50% nghĩa là hệ thống tốt hơn đoán ngẫu nhiên.

### MCC — Matthews Correlation Coefficient (Hệ số tương quan Matthews)

```ts
function mcc(predictions: string[], actuals: string[]): number {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < predictions.length; i++) {
    if (predictions[i] === "up" && actuals[i] === "up") tp++;      // True Positive (đúng tăng)
    else if (predictions[i] === "up" && actuals[i] === "down") fp++;  // False Positive (dự đoán tăng nhưng thực tế giảm)
    else if (predictions[i] === "down" && actuals[i] === "down") tn++; // True Negative (đúng giảm)
    else if (predictions[i] === "down" && actuals[i] === "up") fn++;   // False Negative (dự đoán giảm nhưng thực tế tăng)
  }
  const denom = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  return denom === 0 ? 0 : (tp * tn - fp * fn) / denom;
}
```

**Công thức:**
```
MCC = (TP × TN - FP × FN) / √((TP+FP)(TP+FN)(TN+FP)(TN+FN))
```

**Phạm vi:** -1 đến +1
- **+1:** dự đoán hoàn hảo
- **0:** không tốt hơn đoán ngẫu nhiên
- **-1:** dự đoán hoàn toàn ngược (luôn sai)

**Tại sao dùng MCC thay vì chỉ Accuracy?**
- MCC cân bằng hơn khi dữ liệu lệch (imbalanced). VD: nếu 70% ngày là "up", hệ thống luôn đoán "up" sẽ có accuracy 70% nhưng MCC ≈ 0 (không thực sự dự đoán được gì)
- MCC xét cả 4 trường hợp (TP, FP, TN, FN) nên phản ánh khả năng thực sự

### Hàm `evaluate()` — kết hợp cả hai

```ts
function evaluate(predictions: string[], actuals: string[]) {
  return {
    accuracy: Math.round(accuracy(predictions, actuals) * 10000) / 10000,
    mcc: Math.round(mcc(predictions, actuals) * 10000) / 10000,
    total: predictions.length,       // tổng số dự đoán
    correct: predictions.filter((p, i) => p === actuals[i]).length,  // số đúng
  };
}
```

**Ví dụ kết quả:**
```ts
{
  accuracy: 0.5833,   // 58.33%
  mcc: 0.1692,        // tương quan dương nhẹ
  total: 60,          // 60 ngày test
  correct: 35,        // 35 lần đúng
}
```

---

## 3. Đầu ra backtest — Kiểm tra lại toàn bộ

### File: `src/evaluation/backtest.ts`

Backtest chạy pipeline trên tập test theo **rolling window** (cửa sổ cuộn), mô phỏng giao dịch thực:

### Quy trình backtest

```
Cho mỗi ngày test:
    │
    ├── 1. Nạp tin tức ngày hôm đó vào DB
    ├── 2. Chạy Step 1-3 (trích xuất, gộp, theo dõi)
    ├── 3. Tạo daily vectors
    │
    ├── Với mỗi asset (BTC, ETH):
    │     ├── 4. Chạy Step 6 (dự đoán) — gọi Step 5 bên trong
    │     ├── 5. Ghi log: predicted vs actual
    │     └── 6. Online learning: chạy Step 4 với kết quả thực tế
    │           -> thêm reflection mới vào bộ nhớ
    │
    └── Chuyển sang ngày tiếp theo (bộ nhớ đã mở rộng)
```

### Online Learning (học trực tuyến)

```ts
// Sau khi dự đoán xong và biết kết quả thực
await generateReflection(
  client, date, asset, dayRow.label, dayRow.next_return ?? undefined, "online"
);
```

Mỗi ngày test, sau khi biết kết quả thực:
1. Cập nhật `actual_direction` trong bảng `predictions`
2. Tạo reflection mới (`source = "online"`) -> thêm vào bộ nhớ
3. Ngày test tiếp theo sẽ có thêm kinh nghiệm mới

**Đây là điểm khác biệt quan trọng:** Bộ nhớ **không cố định** mà **lớn dần** qua mỗi ngày test. Giống nhà phân tích thực: dự đoán hôm nay, nhìn kết quả, rút kinh nghiệm, dự đoán ngày mai tốt hơn.

### Kết quả trả về từ `runBacktest()`

```ts
Record<string, {
  accuracy: number;                     // tỷ lệ đúng
  mcc: number;                          // hệ số MCC
  total: number;                        // tổng số dự đoán
  correct: number;                      // số lần đúng
  predictions: [string, string][];      // danh sách [dự đoán, thực tế]
}>
```

**Ví dụ:**
```ts
{
  "BTC": {
    accuracy: 0.5833,
    mcc: 0.1692,
    total: 60,
    correct: 35,
    predictions: [
      ["up", "up"],        // ngày 1: đúng
      ["up", "down"],      // ngày 2: sai
      ["down", "down"],    // ngày 3: đúng
      ["up", "up"],        // ngày 4: đúng
      ...
    ]
  },
  "ETH": {
    accuracy: 0.5500,
    mcc: 0.1023,
    total: 60,
    correct: 33,
    predictions: [...]
  }
}
```

**Log mẫu trong quá trình chạy:**
```
Event memory built for 2025-03-01
Event memory built for 2025-03-02
...
Reflections built for BTC training data
Reflections built for ETH training data
Test 2025-03-15/BTC: predicted=up, actual=up
Test 2025-03-15/ETH: predicted=down, actual=down
Test 2025-03-16/BTC: predicted=up, actual=down
...
BTC: ACC=0.5833, MCC=0.1692
ETH: ACC=0.55, MCC=0.1023
```

---

## 4. Đầu ra trung gian — Tri thức tích luỹ

Ngoài prediction và metrics, hệ thống lưu lại toàn bộ tri thức trung gian. Đây là tài sản có giá trị vì có thể dùng cho phân tích, debug, hoặc các mục đích khác.

### Bảng `raw_events` (từ Step 1)

| Nội dung | Ý nghĩa |
|----------|---------|
| Sự kiện thô trích xuất từ tin tức | Lịch sử đầy đủ mọi sự kiện crypto đã xảy ra, có cấu trúc |
| Embedding cho mỗi sự kiện | Dùng để tìm kiếm ngữ nghĩa (semantic search) |

**Ứng dụng ngoài dự đoán giá:** xây dựng timeline sự kiện, phân tích xu hướng tin tức, theo dõi tần suất sự kiện theo nhóm.

### Bảng `merged_events` (từ Step 2-3)

| Nội dung | Ý nghĩa |
|----------|---------|
| Sự kiện đã gộp (bỏ trùng lặp) | Bản tin tức "sạch", mỗi sự kiện xuất hiện đúng 1 lần |
| `prev_event_id` + `chain_depth` | Chuỗi tiến hoá sự kiện — theo dõi 1 chủ đề qua nhiều ngày |
| `delta_info` | Thông tin gia tăng — điều mới so với kỳ vọng |
| `source_raw_event_ids` | Truy vết: sự kiện gộp này đến từ bài báo nào |

**Ứng dụng:** Xây dựng đồ thị sự kiện (event graph), phân tích chuỗi nhân quả, dashboard theo dõi sự kiện realtime.

### Bảng `daily_vectors` (từ Step 5)

| Nội dung | Ý nghĩa |
|----------|---------|
| Binary vectors (type + group) mỗi ngày | "Fingerprint" (dấu vân tay) sự kiện hàng ngày |

**Ứng dụng:** So sánh nhanh bất kỳ 2 ngày nào, tìm ngày tương tự trong lịch sử, phát hiện pattern (mẫu) lặp lại.

### Bảng `reflections` (từ Step 4)

| Nội dung | Ý nghĩa |
|----------|---------|
| Phân tích nhân quả sự kiện → giá | Kho kinh nghiệm: tình huống X dẫn đến kết quả Y vì lý do Z |
| `source`: "train", "test", "online" | Phân biệt nguồn gốc kinh nghiệm |

**Ứng dụng:** Tìm hiểu pattern: loại sự kiện nào thường dẫn đến tăng/giảm giá, xây dựng báo cáo phân tích tự động.

---

## 5. Tổng hợp tất cả bảng output

| Bảng | Tạo bởi | Số bản ghi (ước tính/ngày) | Mục đích chính |
|------|---------|---------------------------|---------------|
| `raw_news` | Trước Step 1 | 20-100 bài báo | Lưu trữ tin tức gốc |
| `raw_events` | Step 1 | 10-50 sự kiện | Sự kiện thô + embedding |
| `merged_events` | Step 2, cập nhật Step 3 | 5-20 sự kiện | Sự kiện sạch + chuỗi + ΔInfo |
| `daily_vectors` | Step 5 | 1/asset/ngày (2 tổng) | Binary vectors cho Jaccard |
| `reflections` | Step 4 | 1/asset/ngày (2 tổng) | Kinh nghiệm nhân quả |
| `predictions` | Step 6 | 1/asset/ngày (2 tổng) | **Dự đoán cuối cùng** |

---

## 6. Cách đọc và truy xuất kết quả

### Truy vấn prediction mới nhất

```sql
SELECT date, asset, predicted_direction, actual_direction, reason
FROM predictions
ORDER BY created_at DESC
LIMIT 10;
```

### Xem accuracy theo asset

```sql
SELECT asset,
       COUNT(*) as total,
       SUM(CASE WHEN predicted_direction = actual_direction THEN 1 ELSE 0 END) as correct,
       ROUND(1.0 * SUM(CASE WHEN predicted_direction = actual_direction THEN 1 ELSE 0 END) / COUNT(*), 4) as accuracy
FROM predictions
WHERE actual_direction IS NOT NULL
GROUP BY asset;
```

### Xem chuỗi sự kiện dẫn đến dự đoán

```sql
-- 1. Lấy prediction
SELECT * FROM predictions WHERE id = 42;

-- 2. Lấy reflection đã tham chiếu
SELECT * FROM reflections WHERE id IN (12, 45);

-- 3. Lấy sự kiện trong cửa sổ
SELECT * FROM merged_events
WHERE date BETWEEN '2025-03-15' AND '2025-03-20'
  AND (asset = 'BTC' OR asset = 'ALL')
ORDER BY date, id;

-- 4. Xem chuỗi tiến hoá 1 sự kiện
WITH RECURSIVE chain AS (
  SELECT * FROM merged_events WHERE id = 15
  UNION ALL
  SELECT me.* FROM merged_events me
  JOIN chain c ON me.id = c.prev_event_id
)
SELECT id, date, event_type, description, delta_info FROM chain ORDER BY date;
```

### Xem reflection chất lượng nhất

```sql
SELECT date, asset, price_direction, reason, key_events
FROM reflections
WHERE source = 'train'
ORDER BY date DESC
LIMIT 5;
```

---

## 7. Khả năng giải thích (Explainability)

Một lợi thế lớn của StockMem so với mô hình "hộp đen" (black box): **mọi dự đoán đều có thể truy vết ngược**:

```
Prediction #42: BTC up
    │
    ├── Lý do: "CPI tốt + ETF approval + institutional adoption..."
    │
    ├── Tham chiếu reflection #12, #45
    │     ├── Ref #12: tình huống tương tự tháng 1, giá tăng 5%
    │     └── Ref #45: tình huống tương tự tháng 11, giá tăng 3%
    │
    ├── Chuỗi sự kiện [15/3 — 20/3]:
    │     ├── 16/3: CPI 2.5% (ΔInfo: thấp hơn kỳ vọng 2.8%)
    │     ├── 18/3: SEC phê duyệt ETF (ΔInfo: đảo ngược hoãn)
    │     │     └── Chuỗi: xem xét (17/3) -> hoãn (18/3) -> phê duyệt (18/3)
    │     ├── 18/3: BlackRock $500M inflow (ΔInfo: kỷ lục)
    │     └── 20/3: Goldman custody (ΔInfo: ngân hàng lớn đầu tiên)
    │
    └── Nguồn tin gốc:
          ├── raw_event #31 -> CoinDesk: "US CPI drops..."
          ├── raw_event #35,36,37 -> gộp thành merged_event #... (SEC ETF)
          └── ...
```

Từ dự đoán -> lý do -> reflection tham chiếu -> chuỗi sự kiện -> ΔInfo -> sự kiện thô -> bài báo gốc. **Hoàn toàn minh bạch** từ đầu đến cuối.
