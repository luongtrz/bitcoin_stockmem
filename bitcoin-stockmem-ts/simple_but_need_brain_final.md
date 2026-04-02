# StockMem — Bản cuối: Hiểu hết, sửa được

> Đọc file này sau khi đã đọc `simple.md` và `simple_but_need_brain.md`.
> Mục tiêu: sau khi đọc xong, bạn có thể **sửa bất kỳ phần nào** trong code theo ý mình.

---

## Kiến trúc file — Bản đồ codebase

```
src/
├── index.ts                    ← ENTRY POINT: chạy toàn bộ pipeline
├── config.ts                   ← MỌI tham số cấu hình tập trung ở đây
│
├── data/                       ← Thu thập dữ liệu đầu vào
│   ├── news-fetcher.ts         ← Lấy tin tức (CryptoPanic + RSS)
│   ├── price-fetcher.ts        ← Lấy giá (Binance via ccxt)
│   ├── label-generator.ts      ← Tạo nhãn up/down từ giá
│   └── taxonomy.ts             ← Định nghĩa 13 nhóm / 56 loại sự kiện
│
├── llm/                        ← Tầng giao tiếp với LLM
│   ├── gemini-client.ts        ← Gọi Gemini API (rate limit, retry, JSON parse)
│   ├── prompts.ts              ← 6 prompt templates (1 cho mỗi step)
│   └── response-parser.ts      ← Zod schemas validate JSON output từ LLM
│
├── embeddings/                 ← Tầng embedding
│   ├── bge-m3.ts               ← Bridge TypeScript ↔ Python cho embedding
│   ├── embed_server.py         ← Python server chạy model embedding
│   └── vector-store.ts         ← Cosine similarity + Top-K search
│
├── memory/                     ← Tầng bộ nhớ (truy vấn + format dữ liệu)
│   ├── event-memory.ts         ← Xây dựng chuỗi sự kiện, format cho prompt
│   ├── reflection-memory.ts    ← Lưu/đọc reflection, format cho prompt
│   └── similarity.ts           ← Jaccard, binary vectors, tìm chuỗi tương tự
│
├── pipeline/                   ← 6 bước xử lý chính
│   ├── step1-extract.ts
│   ├── step2-merge.ts
│   ├── step3-track.ts
│   ├── step4-reason.ts
│   ├── step5-retrieve.ts
│   └── step6-predict.ts
│
├── storage/                    ← Tầng lưu trữ
│   ├── schemas.ts              ← DDL cho 6 bảng SQLite
│   └── database.ts             ← CRUD operations
│
└── evaluation/                 ← Đánh giá kết quả
    ├── metrics.ts              ← Accuracy, MCC
    └── backtest.ts             ← Rolling backtest + online learning
```

**Nguyên tắc tổ chức:** Mỗi thư mục là 1 tầng (layer), chỉ phụ thuộc tầng dưới. Pipeline gọi memory, memory gọi storage. Không có dependency ngược.

---

## Entry point: `index.ts` — luồng chạy chính

```
main()
  │
  ├── Phase 1: Thu thập dữ liệu
  │     ├── fetchDailyOhlcv() cho BTC, ETH     → giá
  │     ├── fetchAllNews()                       → tin tức
  │     └── generateLabels() + filterTradableDays() → nhãn up/down
  │
  ├── Phase 2: Xây Event Memory (training data)
  │     └── buildEventMemory()                   → chạy Step 1-3 cho mỗi ngày train
  │
  ├── Phase 3: Xây Reflection Memory (training data)
  │     └── buildReflectionMemory()              → chạy Step 4 cho mỗi ngày train
  │
  ├── Phase 4: Backtest (test data)
  │     └── runBacktest()                        → chạy Step 1-3, rồi Step 6 (gọi Step 5 bên trong)
  │                                                + online learning (Step 4 sau mỗi ngày)
  │
  └── Phase 5: In kết quả
        └── console.table(accuracy, MCC)
```

**Chạy:**
```bash
npx tsx src/index.ts
npx tsx src/index.ts --train-start 2025-01-01 --train-end 2025-03-31 \
                     --test-start 2025-04-01 --test-end 2025-06-30
```

---

## Bản đồ phụ thuộc giữa các step

```
Step 1 ──> Step 2 ──> Step 3 ──> Step 4
  │          │          │          │
  │          │          │          v
  │          │          │     reflections
  │          │          │          │
  │          v          v          v
  │     merged_events ─────> Step 5 ──> Step 6 ──> predictions
  │                            │
  v                            v
raw_events                daily_vectors
```

**Quy tắc:** Step N chỉ đọc output của Step 1..N-1. Không có dependency vòng. Nghĩa là bạn có thể chạy lại bất kỳ step nào từ giữa nếu dữ liệu trước đó đã có trong DB.

---

## 10 điểm có thể customize ngay

### 1. Đổi LLM (Gemini → OpenAI / Claude / Local)

**File sửa:** `src/llm/gemini-client.ts`

Chỉ cần class mới implement 1 method:
```ts
async generateJson(prompt: string): Promise<any>
```

Nhận prompt string, trả về parsed JSON. Mọi step đều gọi qua method này. Không cần sửa pipeline.

**Ví dụ đổi sang OpenAI:**
```ts
import OpenAI from "openai";

export class OpenAIClient {
  private client = new OpenAI();

  async generateJson(prompt: string): Promise<any> {
    const res = await this.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    return JSON.parse(res.choices[0].message.content!);
  }
}
```

Sau đó trong `index.ts`, thay `new GeminiClient()` bằng `new OpenAIClient()`.

### 2. Đổi asset (BTC/ETH → SOL, DOGE, cổ phiếu, forex...)

**File sửa:** `src/config.ts`
```ts
// Thêm asset mới
export const ASSETS = ["BTC", "ETH", "SOL"] as const;
export const TRADING_PAIRS: Record<Asset, string> = {
  BTC: "BTC/USDT",
  ETH: "ETH/USDT",
  SOL: "SOL/USDT",  // thêm dòng này
};
```

**File sửa thêm:** `src/data/news-fetcher.ts`
- CryptoPanic: thêm `SOL` vào `currencies=BTC,ETH,SOL`
- RSS: thêm logic phát hiện "SOLANA" / "SOL" trong title

**Nếu đổi sang cổ phiếu:** Thay `ccxt` bằng API khác (Alpha Vantage, Yahoo Finance). Thay CryptoPanic bằng nguồn tin chứng khoán. Thay taxonomy (xem mục 4).

### 3. Thay đổi nguồn tin tức

**File sửa:** `src/data/news-fetcher.ts`

Interface duy nhất cần thoả mãn:
```ts
interface NewsArticle {
  date: string;       // "YYYY-MM-DD"
  title: string;
  url: string;
  source: string;
  asset: string;      // phải khớp với ASSETS trong config
  body: string | null;
}
```

Bạn có thể thay bằng bất kỳ nguồn nào: Twitter/X API, Reddit, Telegram channels, Bloomberg, Reuters... Miễn trả về đúng interface trên.

**Thêm nguồn mới:** Viết 1 hàm `async fetchMySource(): Promise<NewsArticle[]>`, thêm vào `fetchAllNews()`.

### 4. Sửa Taxonomy (thêm/bớt/đổi loại sự kiện)

**File sửa:** `src/data/taxonomy.ts`

```ts
export const EVENT_TAXONOMY: Record<string, string[]> = {
  // Thêm group mới
  "AI & Compute": [
    "GPU Shortage", "AI Model Release", "Compute Market Shift",
  ],
  // Sửa group cũ
  "Regulation & Legal": [
    "Regulatory Announcement",
    "MiCA Compliance",       // thêm type mới cho EU
    // ...
  ],
  // Xoá group: bỏ block code ra khỏi object
};
```

**Ảnh hưởng lan toả:**
- `NUM_TYPES` và `NUM_GROUPS` tự tính lại (derived từ `EVENT_TAXONOMY`)
- `TYPE_TO_INDEX` và `GROUP_TO_INDEX` tự rebuild
- Binary vectors trong Step 5 tự thay đổi kích thước
- **Bảng `daily_vectors` cũ không tương thích** — cần xoá và chạy lại Step 5

**Lưu ý:** Nếu thay đổi taxonomy, prompt Step 1 tự cập nhật (vì `formatTaxonomyForPrompt()` đọc dynamic từ `EVENT_TAXONOMY`). Không cần sửa prompt.

### 5. Tinh chỉnh Hyperparameters

**File sửa:** `src/config.ts`

| Tham số | Mặc định | Tăng lên | Giảm xuống |
|---------|----------|----------|------------|
| `WINDOW_SIZE` | 5 | Nhớ xa hơn, tốn embedding + LLM hơn | Nhớ gần hơn, nhanh hơn |
| `ALPHA` | 0.7 | Type quan trọng hơn (chi tiết hơn) | Group quan trọng hơn (khái quát hơn) |
| `D_MAX` | 5 | Chuỗi sự kiện dài hơn, context lớn hơn | Chuỗi ngắn, focus sự kiện gần |
| `TOP_K_TRACK` | 10 | Nhiều ứng viên hơn cho LLM chọn (chính xác hơn, chậm hơn) | Ít ứng viên, nhanh hơn |
| `TOP_K_RETRIEVE` | 10 | Nhiều chuỗi lịch sử hơn | Ít hơn |
| `PRICE_THRESHOLD` | 0.01 | Chỉ tính biến động lớn là up/down, nhiều ngày "flat" bị loại | Biến động nhỏ cũng tính, ít bị loại |
| `CLUSTER_DISTANCE_THRESHOLD` | 0.3 | Dễ gộp hơn (gộp cả sự kiện hơi khác) | Khó gộp hơn (chỉ gộp khi rất giống) |

### 6. Sửa Prompt (cách LLM xử lý)

**File sửa:** `src/llm/prompts.ts`

6 prompt tương ứng 6 step. Mỗi prompt là template string với `{{variable}}` placeholders.

**Ví dụ tuỳ chỉnh:** Thêm yêu cầu LLM đánh giá mức độ tin cậy:
```ts
export const PREDICT_PROMPT = `\
...
Output strictly in the following JSON format:
{"Reason for price movement": "...", "Price movement": "up/down", "Confidence": "high/medium/low"}
`;
```

**Sau đó sửa:** `response-parser.ts` thêm field mới vào Zod schema:
```ts
const PredictResultSchema = z.object({
  "Reason for price movement": z.string(),
  "Price movement": z.string(),
  "Confidence": z.string().default("medium"),  // thêm field
});
```

**Và sửa:** `step6-predict.ts` + `database.ts` + `schemas.ts` để lưu field mới vào DB.

### 7. Thêm nguồn dữ liệu mới (on-chain, social sentiment...)

**Cách 1 — Nhập như tin tức:** Biến dữ liệu thành `NewsArticle`:
```ts
// Ví dụ: on-chain data → pseudo-article
{
  date: "2025-03-20",
  title: "Bitcoin whale moved 5000 BTC to Binance",
  source: "on-chain-monitor",
  asset: "BTC",
  body: "Address bc1q... transferred 5000 BTC ($325M) to Binance hot wallet...",
  url: "https://...",
}
```

Step 1 sẽ extract sự kiện từ "bài báo" này như bình thường.

**Cách 2 — Thêm feature mới vào binary vector:** Mở rộng `daily_vectors` với thêm chiều (VD: fear/greed index, funding rate). Sửa `similarity.ts` để tính similarity kết hợp.

### 8. Đổi Embedding model

**File sửa:** `src/embeddings/embed_server.py`

```python
def load_model():
    # Thay model khác
    model_name = "intfloat/multilingual-e5-large"  # hoặc bất kỳ model nào
    return SentenceTransformer(model_name, device=device)
```

**Hoặc dùng API embedding (không cần Python):** Viết lại `src/embeddings/bge-m3.ts`, thay `spawn(python)` bằng gọi API (OpenAI embeddings, Cohere, v.v.).

**Lưu ý:** Nếu đổi model, chiều embedding thay đổi → embedding cũ trong DB không tương thích → cần xoá `raw_events` + `merged_events` và chạy lại từ Step 1.

### 9. Đổi DB (SQLite → PostgreSQL / MongoDB...)

**File sửa:** `src/storage/database.ts` + `src/storage/schemas.ts`

Tất cả truy vấn DB tập trung trong `database.ts`. Các hàm cần thay:
```ts
getDb()              // connection
insertRawNews()      // INSERT
insertRawEvents()    // INSERT
insertMergedEvents() // INSERT
insertReflection()   // INSERT
insertPrediction()   // INSERT
queryMergedEventsByDateRange()  // SELECT
queryReflectionsByIds()         // SELECT
```

Và các câu `d.prepare(...)` rải trong `step2-merge.ts`, `step3-track.ts`, `step5-retrieve.ts`. Grep `getDb()` để tìm hết.

### 10. Thêm metric đánh giá mới

**File sửa:** `src/evaluation/metrics.ts`

```ts
// Thêm Precision, Recall, F1
export function precision(predictions: string[], actuals: string[]): number {
  const tp = predictions.filter((p, i) => p === "up" && actuals[i] === "up").length;
  const fp = predictions.filter((p, i) => p === "up" && actuals[i] === "down").length;
  return tp + fp === 0 ? 0 : tp / (tp + fp);
}

// Thêm Sharpe ratio (cần thêm return data)
export function sharpe(returns: number[]): number {
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(returns.map(r => (r - mean) ** 2).reduce((a, b) => a + b, 0) / returns.length);
  return std === 0 ? 0 : (mean / std) * Math.sqrt(252); // annualized
}
```

---

## Kịch bản customize thực tế

### Kịch bản A: "Tôi muốn dự đoán SOL thay vì ETH"

```
1. config.ts       → thêm SOL vào ASSETS + TRADING_PAIRS
2. news-fetcher.ts → thêm SOL vào CryptoPanic filter + RSS detection
3. Chạy lại pipeline
```

Thời gian: ~10 phút.

### Kịch bản B: "Tôi muốn dùng GPT-4o thay Gemini"

```
1. Viết OpenAIClient (implement generateJson)
2. index.ts → thay new GeminiClient() bằng new OpenAIClient()
3. config.ts → sửa rate limit params cho phù hợp
```

Thời gian: ~30 phút.

### Kịch bản C: "Tôi muốn thêm dữ liệu Fear & Greed Index"

```
Cách nhanh:
1. Viết hàm fetch Fear & Greed → chuyển thành NewsArticle
2. Thêm vào fetchAllNews()
→ Pipeline tự extract sự kiện từ đó

Cách kỹ:
1. Thêm cột fear_greed vào daily_vectors
2. Sửa dailySim() thêm trọng số cho fear_greed
3. Sửa prompt Step 6 thêm context fear_greed
```

### Kịch bản D: "Tôi muốn dùng cho cổ phiếu VN30"

```
1. taxonomy.ts     → dùng lại taxonomy gốc của paper (cổ phiếu, Appendix A)
2. news-fetcher.ts → thay bằng nguồn tin VN (CafeF, VnExpress kinh doanh...)
3. price-fetcher.ts → thay ccxt bằng API SSI/VNDirect/TCBS
4. config.ts       → ASSETS = ["VNM", "VCB", ...], đổi TRADING_PAIRS
5. label-generator.ts → có thể giữ nguyên hoặc sửa PRICE_THRESHOLD
6. prompts.ts      → đổi "cryptocurrency" thành "Vietnamese stock market"
```

Thời gian: ~2-4 giờ (chủ yếu viết news-fetcher và price-fetcher mới).

### Kịch bản E: "Tôi muốn chạy realtime, dự đoán mỗi ngày"

```
1. Viết cron job / scheduler chạy mỗi ngày lúc 23:00
2. Mỗi lần chạy:
   a. fetchAllNews(today, today)        → tin hôm nay
   b. extractEventsForDay(today)        → Step 1
   c. mergeEventsForDay(today)          → Step 2
   d. trackEventsForDay(today)          → Step 3
   e. predict(today, "BTC")             → Step 5+6 → kết quả
3. Ngày hôm sau: lấy giá thực tế → cập nhật actual_direction
   → generateReflection() → online learning
```

### Kịch bản F: "Tôi muốn tắt Step 5 (retrieval) để test xem nó có thực sự giúp ích không"

```
step6-predict.ts → thay:
  const { reflections, refIds } = await retrieveReferences(client, date, asset);
Bằng:
  const reflections: Record<string, any>[] = [];
  const refIds: number[] = [];

→ histReflection sẽ = "No historical reference experience available."
→ LLM dự đoán chỉ dựa vào sự kiện + ΔInfo (không có kinh nghiệm lịch sử)
→ So sánh accuracy có/không có retrieval → biết giá trị của Step 5
```

### Kịch bản G: "Tôi muốn tắt ΔInfo để test"

```
memory/event-memory.ts → formatSeriesForPrompt():
  Thay includeDeltaInfo = true bằng false ở nơi gọi (step4, step6)

Hoặc đơn giản hơn: step3-track.ts → comment hết logic tracking,
  không UPDATE merged_events → delta_info luôn null
→ So sánh accuracy có/không ΔInfo → biết giá trị của Step 3
```

---

## Những chỗ dễ vấp

### 1. Embedding dimension mismatch

Nếu đổi embedding model (VD: từ BGE-M3 1024 chiều sang MiniLM 384 chiều), embedding cũ trong DB không còn dùng được. **Phải xoá DB và chạy lại từ đầu.**

### 2. Taxonomy thay đổi → daily_vectors hỏng

Binary vectors có kích thước cố định (56 type + 13 group). Nếu thêm/bớt type/group, vectors cũ lệch index. **Phải xoá bảng `daily_vectors` và chạy lại Step 5.**

### 3. Rate limit Gemini

`GEMINI_RPM = 15` (15 request/phút). Một ngày có nhiều tin → Step 1 gọi nhiều batch → Step 2 gọi nhiều cụm → Step 3 gọi nhiều sự kiện. Dễ bị rate limit nếu tăng lượng tin tức.

**Giải pháp:** Tăng `GEMINI_RETRY_DELAY`, hoặc dùng model có rate limit cao hơn, hoặc batch lớn hơn (tăng `BATCH_SIZE` trong Step 1).

### 4. CryptoPanic API key

CryptoPanic Developer API v2 cần API key trả phí. Nếu không có, chỉ còn RSS (ít tin hơn, không có body). Đặt `CRYPTOPANIC_API_KEY` trong `.env`.

### 5. Python embedding server

Embedding chạy qua Python subprocess. Cần:
- Python 3 + `sentence-transformers` + `torch` cài sẵn
- Hoặc `.venv` trong thư mục project với các package trên
- Nếu không có GPU, tự fallback sang MiniLM (384 chiều thay vì 1024)

### 6. SQLite concurrent write

SQLite không hỗ trợ ghi đồng thời tốt. Nếu muốn chạy song song nhiều asset hoặc nhiều ngày, cần đổi sang PostgreSQL hoặc dùng write queue.

---

## Cheat sheet: "Muốn sửa X thì mở file nào?"

| Muốn sửa | Mở file |
|-----------|---------|
| Thêm/bớt asset | `config.ts` + `news-fetcher.ts` + `price-fetcher.ts` |
| Đổi LLM | `llm/gemini-client.ts` |
| Sửa cách LLM xử lý | `llm/prompts.ts` |
| Sửa cấu trúc JSON output LLM | `llm/response-parser.ts` |
| Thêm/bớt loại sự kiện | `data/taxonomy.ts` |
| Đổi nguồn tin | `data/news-fetcher.ts` |
| Đổi nguồn giá | `data/price-fetcher.ts` |
| Sửa ngưỡng up/down | `config.ts` → `PRICE_THRESHOLD` |
| Đổi embedding model | `embeddings/embed_server.py` |
| Sửa logic clustering | `pipeline/step2-merge.ts` → `clusterEvents()` |
| Sửa cách tính ΔInfo | `pipeline/step3-track.ts` |
| Sửa cách tính similarity | `memory/similarity.ts` |
| Sửa format sự kiện cho prompt | `memory/event-memory.ts` → `formatSeriesForPrompt()` |
| Sửa format reflection cho prompt | `memory/reflection-memory.ts` → `formatReflectionsForPrompt()` |
| Thêm cột DB | `storage/schemas.ts` + `storage/database.ts` |
| Thêm metric đánh giá | `evaluation/metrics.ts` |
| Sửa logic backtest | `evaluation/backtest.ts` |
| Sửa hyperparameters | `config.ts` |
| Sửa khoảng thời gian train/test | CLI args hoặc `index.ts` → `parseArgs()` |

---

## Thứ tự đọc code đề xuất

Nếu muốn đọc code từ đầu:

```
1. config.ts              ← hiểu tham số trước
2. data/taxonomy.ts       ← hiểu hệ thống phân loại
3. llm/prompts.ts         ← hiểu LLM được yêu cầu gì
4. llm/response-parser.ts ← hiểu LLM phải trả về gì
5. pipeline/step1 → step6 ← đọc theo thứ tự, mỗi file ~50-100 dòng
6. memory/*               ← hiểu bộ nhớ format dữ liệu thế nào
7. evaluation/backtest.ts ← hiểu luồng chạy tổng thể
8. index.ts               ← entry point, gọi hết mọi thứ
```

Mỗi file ngắn (~50-150 dòng), comment rõ ràng. Tổng code thực sự < 1500 dòng (không tính node_modules).
