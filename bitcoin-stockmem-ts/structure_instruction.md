# Kiến trúc thư mục & Hướng dẫn từng file

## Cây thư mục tổng thể

```
bitcoin-stockmem-ts/
│
├── package.json                 Khai báo dependencies + scripts
├── tsconfig.json                Cấu hình TypeScript compiler
├── .env                         Biến môi trường (API keys) — KHÔNG commit lên git
│
├── data/                        Thư mục chứa DB SQLite (tự tạo khi chạy)
│   └── stockmem.db              Database chính (tự sinh, không cần tạo tay)
│
├── src/                         ★ Toàn bộ mã nguồn
│   ├── index.ts                 Entry point — điều phối toàn bộ pipeline
│   ├── config.ts                Cấu hình tập trung (API keys, hyperparameters, paths)
│   │
│   ├── data/                    Tầng thu thập dữ liệu đầu vào
│   │   ├── news-fetcher.ts      Lấy tin tức từ CryptoPanic + RSS
│   │   ├── price-fetcher.ts     Lấy giá OHLCV từ Binance
│   │   ├── label-generator.ts   Tạo nhãn up/down từ dữ liệu giá
│   │   └── taxonomy.ts          Định nghĩa hệ thống phân loại sự kiện
│   │
│   ├── llm/                     Tầng giao tiếp với LLM
│   │   ├── gemini-client.ts     Client gọi Gemini API
│   │   ├── prompts.ts           6 prompt templates cho 6 bước
│   │   └── response-parser.ts   Zod schemas kiểm tra JSON từ LLM
│   │
│   ├── embeddings/              Tầng embedding (véc-tơ ngữ nghĩa)
│   │   ├── bge-m3.ts            Bridge TypeScript ↔ Python
│   │   ├── embed_server.py      Python server chạy mô hình embedding
│   │   └── vector-store.ts      Cosine similarity + Top-K search
│   │
│   ├── memory/                  Tầng bộ nhớ (truy vấn + định dạng dữ liệu)
│   │   ├── event-memory.ts      Xây dựng chuỗi sự kiện, format cho prompt
│   │   ├── reflection-memory.ts Lưu/đọc kinh nghiệm, format cho prompt
│   │   └── similarity.ts        Jaccard similarity, binary vectors, tìm chuỗi tương tự
│   │
│   ├── pipeline/                ★ 6 bước xử lý chính
│   │   ├── step1-extract.ts     Trích xuất sự kiện từ tin tức
│   │   ├── step2-merge.ts       Gộp sự kiện trùng lặp
│   │   ├── step3-track.ts       Theo dõi chuỗi sự kiện + tính ΔInfo
│   │   ├── step4-reason.ts      Tạo phản chiếu (reflection)
│   │   ├── step5-retrieve.ts    Truy xuất lịch sử tương tự
│   │   └── step6-predict.ts     Dự đoán cuối cùng
│   │
│   ├── storage/                 Tầng lưu trữ (SQLite)
│   │   ├── schemas.ts           DDL định nghĩa 6 bảng
│   │   └── database.ts          Kết nối DB + tất cả hàm CRUD
│   │
│   └── evaluation/              Tầng đánh giá kết quả
│       ├── metrics.ts           Tính Accuracy, MCC
│       └── backtest.ts          Chạy backtest + online learning
│
└── docs/                        Tài liệu phân tích (các file .md)
```

---

## Nguyên tắc kiến trúc

### Phân tầng (Layered Architecture)

```
index.ts (điều phối)
    │
    ├── evaluation/     ← gọi pipeline
    │       │
    │       v
    ├── pipeline/       ← gọi memory + llm
    │       │
    │       v
    ├── memory/         ← gọi storage + embeddings
    │       │
    │       v
    ├── llm/            ← gọi external API (Gemini)
    ├── embeddings/     ← gọi external process (Python)
    ├── data/           ← gọi external API (Binance, CryptoPanic)
    │       │
    │       v
    └── storage/        ← gọi SQLite
```

**Quy tắc:** Tầng trên gọi tầng dưới. Không có dependency ngược. Mỗi tầng có thể thay thế độc lập.

### Mỗi file có trách nhiệm duy nhất (Single Responsibility)

Không có file nào vừa đọc DB vừa gọi API vừa tính toán. Mỗi file làm đúng 1 việc.

---

## Chi tiết từng file

### `src/index.ts` — Entry Point (130 dòng)

**Trách nhiệm:** Điều phối toàn bộ pipeline từ đầu đến cuối.

**Làm gì:**
1. Parse CLI arguments (khoảng thời gian train/test)
2. Khởi tạo DB + Gemini client
3. Thu thập dữ liệu: giá (Binance) + tin tức (CryptoPanic + RSS)
4. Tạo nhãn up/down từ dữ liệu giá
5. Gọi `buildEventMemory()` — chạy Step 1-3 cho training data
6. Gọi `buildReflectionMemory()` — chạy Step 4 cho training data
7. Gọi `runBacktest()` — chạy pipeline đầy đủ trên test data
8. In kết quả accuracy + MCC

**Export:** Không export gì — đây là file chạy trực tiếp.

**Gọi đến:** `config`, `GeminiClient`, `getDb`, `fetchDailyOhlcv`, `fetchAllNews`, `generateLabels`, `filterTradableDays`, `buildEventMemory`, `buildReflectionMemory`, `runBacktest`, `shutdown`.

---

### `src/config.ts` — Cấu hình tập trung (64 dòng)

**Trách nhiệm:** Một nơi duy nhất chứa mọi hằng số, đường dẫn, API keys, hyperparameters.

**Export chính:**

| Export | Giá trị | Dùng ở đâu |
|--------|---------|------------|
| `DB_PATH` | `data/stockmem.db` | `storage/database.ts` |
| `GEMINI_API_KEY` | từ `process.env` | `llm/gemini-client.ts` |
| `CRYPTOPANIC_API_KEY` | từ `process.env` | `data/news-fetcher.ts` |
| `ASSETS` | `["BTC", "ETH"]` | `index.ts`, `backtest.ts` |
| `TRADING_PAIRS` | `{BTC: "BTC/USDT", ETH: "ETH/USDT"}` | `data/price-fetcher.ts` |
| `WINDOW_SIZE` | `5` | `step3-track`, `step4-reason`, `step5-retrieve`, `step6-predict` |
| `ALPHA` | `0.7` | `memory/similarity.ts` |
| `D_MAX` | `5` | `step3-track.ts` |
| `TOP_K_TRACK` | `10` | `step3-track.ts` |
| `TOP_K_RETRIEVE` | `10` | `step5-retrieve.ts` |
| `PRICE_THRESHOLD` | `0.01` | `data/label-generator.ts` |
| `CLUSTER_DISTANCE_THRESHOLD` | `0.3` | `step2-merge.ts` |
| `GEMINI_MODEL` | `"gemini-2.5-flash"` | `llm/gemini-client.ts` |
| `GEMINI_RPM` | `15` | `llm/gemini-client.ts` |
| `GEMINI_TEMPERATURE` | `0.0` | `llm/gemini-client.ts` |
| `PYTHON_EMBED_SCRIPT` | đường dẫn `embed_server.py` | `embeddings/bge-m3.ts` |

**Quy tắc:** Mọi con số "magic" nằm ở đây, không rải trong code.

---

## Thư mục `src/data/` — Thu thập dữ liệu đầu vào

### `data/news-fetcher.ts` — Lấy tin tức (170 dòng)

**Trách nhiệm:** Lấy tin tức crypto từ nhiều nguồn, chuẩn hoá thành format chung.

**Export:**
- `NewsArticle` — interface: `{date, title, url, source, asset, body}`
- `fetchCryptoPanic(startDate?, endDate?)` — gọi CryptoPanic Developer API v2, trả về `NewsArticle[]`
- `fetchRss(startDate?, endDate?)` — parse 3 nguồn RSS (CoinDesk, CoinTelegraph, The Block)
- `fetchAllNews(startDate, endDate)` — gọi song song cả 2, deduplicate theo URL, sort theo ngày

**Gọi đến:** `config.CRYPTOPANIC_API_KEY`, `rss-parser` (dynamic import).

---

### `data/price-fetcher.ts` — Lấy giá (67 dòng)

**Trách nhiệm:** Lấy dữ liệu giá OHLCV hàng ngày từ Binance.

**Export:**
- `PriceRow` — interface: `{date, open, high, low, close, volume, return_pct}`
- `fetchDailyOhlcv(asset, startDate, endDate?)` — gọi Binance qua `ccxt`, tính `return_pct` (% thay đổi giá so hôm qua)

**Gọi đến:** `ccxt.binance`, `config.TRADING_PAIRS`.

---

### `data/label-generator.ts` — Tạo nhãn (30 dòng)

**Trách nhiệm:** Chuyển dữ liệu giá thành nhãn phân loại.

**Export:**
- `LabelledRow` — extends `PriceRow` thêm `{next_return, label}`
- `generateLabels(rows, threshold?)` — gán nhãn: return > +1% → "up", < -1% → "down", còn lại → "flat"
- `filterTradableDays(rows)` — lọc bỏ ngày "flat" (không đủ biến động)

**Gọi đến:** `config.PRICE_THRESHOLD`.

---

### `data/taxonomy.ts` — Hệ thống phân loại sự kiện (74 dòng)

**Trách nhiệm:** Định nghĩa hệ thống phân loại 2 cấp (group → types) và cung cấp lookup maps.

**Export:**
- `EVENT_TAXONOMY` — object: `Record<string, string[]>` (13 nhóm, mỗi nhóm có mảng types)
- `ALL_GROUPS` — mảng 13 tên nhóm
- `ALL_TYPES` — mảng 56 tên loại (flatten từ `EVENT_TAXONOMY`)
- `GROUP_TO_INDEX` — Map: tên nhóm → chỉ mục (0-12)
- `TYPE_TO_INDEX` — Map: tên loại → chỉ mục (0-55)
- `NUM_GROUPS` — 13
- `NUM_TYPES` — 56
- `formatTaxonomyForPrompt()` — format taxonomy thành text cho prompt LLM

**Ai gọi:**
- `step1-extract.ts` gọi `formatTaxonomyForPrompt()` để đưa vào prompt
- `memory/similarity.ts` gọi `TYPE_TO_INDEX`, `GROUP_TO_INDEX` để tạo binary vectors

---

## Thư mục `src/llm/` — Giao tiếp với LLM

### `llm/gemini-client.ts` — Client gọi Gemini API (104 dòng)

**Trách nhiệm:** Gọi Gemini API với rate limiting (giới hạn tốc độ), retry (thử lại), và parse JSON.

**Export:**
- `GeminiClient` — class chính
  - `generate(prompt, jsonMode?)` — gọi API, trả về text thô
  - `generateJson(prompt)` — gọi API ở JSON mode, trả về parsed object
- `parseJsonResponse(text)` — parse JSON thông minh: thử trực tiếp → tìm markdown fence → tìm cặp ngoặc

**Cơ chế nội bộ:**
- Rate limit: tối thiểu `60000/GEMINI_RPM` ms giữa các request
- Retry: tối đa `GEMINI_MAX_RETRIES` lần, mỗi lần chờ `GEMINI_RETRY_DELAY × attempt` giây
- Temperature: 0.0 (tắt ngẫu nhiên)

**Đổi LLM khác:** Viết class mới, chỉ cần implement method `generateJson(prompt: string): Promise<any>`.

---

### `llm/prompts.ts` — 6 Prompt Templates (179 dòng)

**Trách nhiệm:** Chứa 6 prompt template (1 cho mỗi step) + hàm fill template.

**Export:**

| Constant | Step | LLM được yêu cầu làm gì |
|----------|------|--------------------------|
| `EXTRACT_PROMPT` | Step 1 | Đọc bài báo → trích xuất JSON sự kiện |
| `MERGE_PROMPT` | Step 2 | Xem cụm sự kiện → quyết định gộp/tách |
| `TRACK_PROMPT` | Step 3 | Xem sự kiện + ứng viên → xác nhận tiền thân + viết ΔInfo |
| `REASON_PROMPT` | Step 4 | Xem chuỗi sự kiện + giá thực tế → giải thích lý do |
| `RETRIEVE_PROMPT` | Step 5 | Xem chuỗi hiện tại + ứng viên lịch sử → chọn chuỗi thực sự giống |
| `PREDICT_PROMPT` | Step 6 | Xem sự kiện + ΔInfo + kinh nghiệm → dự đoán up/down |

- `fillTemplate(template, vars)` — thay `{{key}}` bằng giá trị tương ứng

**Cách sửa prompt:** Sửa trực tiếp template string. Placeholder `{{variable}}` sẽ được thay bằng giá trị thực khi gọi `fillTemplate()`.

---

### `llm/response-parser.ts` — Zod Schemas (95 dòng)

**Trách nhiệm:** Định nghĩa cấu trúc JSON kỳ vọng từ LLM + validate + parse an toàn.

**Export:**

| Schema | Step | Các trường chính |
|--------|------|------------------|
| `ExtractedEventSchema` | Step 1 | `event_group`, `event_type`, `description`, `entities`, `industries` |
| `MergedEventSchema` | Step 2 | Giống trên + `source_event_ids` |
| `TrackResultSchema` | Step 3 | `has_predecessor`, `predecessor_id`, `delta_info` |
| `ReasonResultSchema` | Step 4 | `"Reason for price movement"`, `"Events causing the impact"` |
| `RetrieveResultSchema` | Step 5 | `selected_indices` |
| `PredictResultSchema` | Step 6 | `"Reason for price movement"`, `"Price movement"` |

- `parseExtractedEvents(data)` — parse mảng, bỏ qua phần tử không hợp lệ (không crash)
- `parseMergedEvents(data)` — tương tự
- `parseTrackResult(data)` — parse 1 object
- `parseReasonResult(data)`, `parseRetrieveResult(data)`, `parsePredictResult(data)`

**Triết lý:** Sai 1 sự kiện thì bỏ qua, không làm crash cả batch. Dùng `.default()` để tự điền giá trị mặc định khi LLM thiếu trường.

---

## Thư mục `src/embeddings/` — Véc-tơ ngữ nghĩa

### `embeddings/bge-m3.ts` — Bridge TypeScript ↔ Python (155 dòng)

**Trách nhiệm:** Gọi Python subprocess để tính embedding, quản lý 2 chế độ chạy.

**Export:**
- `encode(texts: string[])` — nhận mảng text, trả về mảng embedding (mảng số)
- `encodeSingle(text)` — encode 1 text
- `embeddingToBuffer(embedding)` — `number[]` → `Buffer` (Float32) để lưu SQLite BLOB
- `bufferToEmbedding(buf)` — `Buffer` → `number[]` để tính toán
- `shutdown()` — tắt server Python

**2 chế độ:**
- **Server mode (ưu tiên):** Spawn Python 1 lần, giữ sống, gửi text qua stdin → nhận embedding qua stdout. Nhanh vì không load lại model.
- **One-shot mode (fallback):** Spawn Python mới mỗi lần. Chậm nhưng đơn giản. Dùng khi server mode thất bại.

**Gọi đến:** `config.PYTHON_EMBED_SCRIPT`, `child_process.spawn`.

---

### `embeddings/embed_server.py` — Python Embedding Server (50 dòng)

**Trách nhiệm:** Load model embedding + encode text thành véc-tơ.

**Logic chọn model:**
- Có GPU → `BAAI/bge-m3` (1024 chiều, mạnh)
- Không GPU → `sentence-transformers/all-MiniLM-L6-v2` (384 chiều, nhẹ)

**2 chế độ:**
- `--serve` → server mode: đọc JSON lines từ stdin, viết embedding JSON lines ra stdout
- Không flag → one-shot: đọc stdin 1 lần, trả kết quả 1 lần

**Gọi đến:** `sentence-transformers`, `torch`.

---

### `embeddings/vector-store.ts` — Cosine Similarity (27 dòng)

**Trách nhiệm:** Tính cosine similarity giữa các embedding + tìm Top-K.

**Export:**
- `cosineSimilarity(a, b)` — tích vô hướng (dot product). Giả định embedding đã L2-normalised.
- `topKSimilar(query, corpus, corpusIds, k)` — tính sim với toàn bộ corpus, trả Top-K có score cao nhất.

**Ai gọi:** `step2-merge.ts` (clustering), `step3-track.ts` (tìm predecessor).

---

## Thư mục `src/memory/` — Bộ nhớ

### `memory/event-memory.ts` — Bộ nhớ sự kiện (95 dòng)

**Trách nhiệm:** Truy vấn sự kiện từ DB + xây dựng chuỗi thời gian + format thành text cho prompt.

**Export:**
- `getEventsForDate(date, asset?)` — lấy `merged_events` theo ngày
- `getEventChain(eventId, maxDepth?)` — đi ngược linked list `prev_event_id`, trả mảng sự kiện
- `buildEventSeries(endDate, window, asset?)` — tạo chuỗi sự kiện w+1 ngày: `{dates[], eventsPerDay[][]}`
- `formatSeriesForPrompt(dates, eventsPerDay, includeDeltaInfo?)` — format thành text có dạng `=== ngày === [group/type] mô tả ΔInfo: ...`
- `computeAndStoreDailyVectors(date, asset)` — gọi `storeDailyVector()` từ `similarity.ts`

**Ai gọi:** `step4-reason`, `step5-retrieve`, `step6-predict` gọi `buildEventSeries` + `formatSeriesForPrompt`.

---

### `memory/reflection-memory.ts` — Bộ nhớ phản chiếu (76 dòng)

**Trách nhiệm:** Lưu và đọc reflection (kinh nghiệm phân tích) + format cho prompt.

**Export:**
- `storeReflection(params)` — lưu reflection vào bảng `reflections`
- `getReflectionByWindow(windowEnd, asset)` — tìm reflection theo ngày kết thúc cửa sổ + asset
- `getReflectionsForDateRange(start, end, asset?)` — lấy reflection trong khoảng ngày
- `formatReflectionsForPrompt(reflections)` — format thành text `--- Historical Reference N --- Period: ... Analysis: ... Key events: ...`

**Ai gọi:** `step4-reason` gọi `storeReflection`, `step5-retrieve` gọi `getReflectionByWindow` + `formatReflectionsForPrompt`, `step6-predict` gọi `formatReflectionsForPrompt`.

---

### `memory/similarity.ts` — Jaccard Similarity (131 dòng)

**Trách nhiệm:** Tạo binary vectors + tính Jaccard similarity + tìm chuỗi lịch sử tương tự nhất.

**Export:**
- `buildTypeVector(eventTypes)` — tên loại → véc-tơ 56 chiều (0/1)
- `buildGroupVector(eventGroups)` — tên nhóm → véc-tơ 13 chiều (0/1)
- `jaccard(a, b)` — tính Jaccard giữa 2 binary vectors
- `dailySim(tv1, gv1, tv2, gv2, alpha?)` — `α × Jaccard(type) + (1-α) × Jaccard(group)`
- `seqSim(seriesA, seriesB)` — trung bình `dailySim` qua cả cửa sổ (căn phải)
- `storeDailyVector(date, asset, events)` — lưu vào bảng `daily_vectors`
- `loadDailyVector(date, asset)` — đọc từ DB
- `loadSeriesVectors(dates, asset)` — đọc chuỗi vectors
- `findTopKSequences(currentDates, allHistoryDates, asset, k)` — sliding window qua toàn bộ lịch sử, trả Top-K chuỗi tương tự nhất

**Ai gọi:** `step5-retrieve.ts` gọi `findTopKSequences`, `computeAndStoreDailyVectors`.

---

## Thư mục `src/pipeline/` — 6 bước xử lý chính

### `pipeline/step1-extract.ts` (91 dòng)

**Trách nhiệm:** Biến tin tức thô thành sự kiện có cấu trúc.

**Export:**
- `extractEventsForDay(client, articles, date)` — xử lý 1 ngày: chia batch → gọi LLM → parse → tính embedding → trả `RawEventRow[]`
- `runExtraction(client, newsByDate)` — xử lý nhiều ngày: gọi `extractEventsForDay` từng ngày → insert DB → trả map `{date: ids[]}`

**Gọi đến:** `GeminiClient.generateJson`, `formatTaxonomyForPrompt`, `parseExtractedEvents`, `encode`, `insertRawEvents`.

---

### `pipeline/step2-merge.ts` (154 dòng)

**Trách nhiệm:** Gộp sự kiện trùng lặp trong cùng ngày.

**Export:**
- `mergeEventsForDay(client, date)` — đọc `raw_events` → nhóm theo group → cluster bằng cosine → gọi LLM merge → tính embedding mới → insert `merged_events`

**Hàm nội bộ:**
- `clusterEvents(events)` — agglomerative clustering: single-pass, ngưỡng cosine distance < 0.3

**Gọi đến:** `GeminiClient.generateJson`, `parseMergedEvents`, `cosineSimilarity`, `bufferToEmbedding`, `encode`, `insertMergedEvents`, `getDb`.

---

### `pipeline/step3-track.ts` (117 dòng)

**Trách nhiệm:** Tìm sự kiện tiền thân + xây chuỗi + trích xuất ΔInfo.

**Export:**
- `trackEventsForDay(client, date)` — đọc `merged_events` hôm nay + lịch sử → Top-K cosine → gọi LLM xác nhận → UPDATE `prev_event_id`, `chain_depth`, `delta_info`

**Hàm nội bộ:**
- `getWindowDates(date, window)` — tính khoảng [t-w, t-1]

**Gọi đến:** `GeminiClient.generateJson`, `parseTrackResult`, `topKSimilar`, `bufferToEmbedding`, `queryMergedEventsByDateRange`, `getDb`.

---

### `pipeline/step4-reason.ts` (56 dòng)

**Trách nhiệm:** Tạo reflection — phân tích nhân quả sự kiện → giá.

**Export:**
- `generateReflection(client, date, asset, priceDirection, priceChangePct?, source?)` — xây chuỗi sự kiện → gọi LLM → lưu vào `reflections`

**Gọi đến:** `GeminiClient.generateJson`, `parseReasonResult`, `buildEventSeries`, `formatSeriesForPrompt`, `storeReflection`.

---

### `pipeline/step5-retrieve.ts` (112 dòng)

**Trách nhiệm:** Tìm chuỗi sự kiện lịch sử tương tự nhất (2 giai đoạn: Jaccard + LLM).

**Export:**
- `retrieveReferences(client, date, asset)` — tạo daily vectors → `findTopKSequences` → xây text ứng viên + reflection → gọi LLM lọc → trả `{reflections[], refIds[]}`

**Hàm nội bộ:**
- `getAllAvailableDates(beforeDate, asset)` — lấy tất cả ngày có sự kiện trước ngày chỉ định

**Gọi đến:** `GeminiClient.generateJson`, `parseRetrieveResult`, `findTopKSequences`, `buildEventSeries`, `formatSeriesForPrompt`, `computeAndStoreDailyVectors`, `getReflectionByWindow`.

---

### `pipeline/step6-predict.ts` (75 dòng)

**Trách nhiệm:** Tổng hợp 3 nguồn thông tin → dự đoán up/down.

**Export:**
- `predict(client, date, asset)` — xây chuỗi sự kiện → gọi `retrieveReferences` (Step 5) → xây prompt → gọi LLM → chuẩn hoá direction → lưu `predictions` → trả `{id, date, asset, predictedDirection, reason, refIds}`

**Gọi đến:** `GeminiClient.generateJson`, `parsePredictResult`, `buildEventSeries`, `formatSeriesForPrompt`, `retrieveReferences`, `formatReflectionsForPrompt`, `insertPrediction`.

---

## Thư mục `src/storage/` — Lưu trữ

### `storage/schemas.ts` (94 dòng)

**Trách nhiệm:** Định nghĩa DDL cho 6 bảng SQLite.

**Export:**
- `SCHEMA_SQL` — chuỗi SQL chứa toàn bộ `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX`

**6 bảng:**

| Bảng | Ghi bởi | Cột đáng chú ý |
|------|---------|-----------------|
| `raw_news` | `backtest.ts` | `UNIQUE(url)` — tránh trùng tin |
| `raw_events` | Step 1 | `embedding BLOB` — véc-tơ nhị phân |
| `merged_events` | Step 2, cập nhật Step 3 | `prev_event_id`, `chain_depth`, `delta_info` |
| `daily_vectors` | Step 5 | `PRIMARY KEY (date, asset)` — 1 vector/ngày/asset |
| `reflections` | Step 4 | `source TEXT` — phân biệt train/test/online |
| `predictions` | Step 6 | `actual_direction` — điền sau khi biết kết quả |

---

### `storage/database.ts` (266 dòng)

**Trách nhiệm:** Quản lý kết nối SQLite + tất cả hàm CRUD.

**Export:**

| Hàm | Thao tác | Bảng |
|-----|----------|------|
| `getDb(dbPath?)` | Mở kết nối (singleton), tạo bảng nếu chưa có | - |
| `closeDb()` | Đóng kết nối | - |
| `insertRawNews(rows)` | INSERT OR IGNORE (bỏ qua trùng URL) | `raw_news` |
| `insertRawEvents(rows)` | INSERT, trả mảng ID | `raw_events` |
| `insertMergedEvents(rows)` | INSERT, trả mảng ID | `merged_events` |
| `insertReflection(row)` | INSERT, trả ID | `reflections` |
| `insertPrediction(row)` | INSERT, trả ID | `predictions` |
| `queryMergedEventsByDateRange(start, end, asset?)` | SELECT theo khoảng ngày | `merged_events` |
| `queryReflectionsByIds(ids)` | SELECT theo danh sách ID | `reflections` |

**Interfaces:** `RawNewsRow`, `RawEventRow`, `MergedEventRow`, `ReflectionRow`, `PredictionRow`.

**Đặc điểm:** Dùng transaction cho bulk insert (nhanh hơn insert từng dòng). WAL mode cho đọc/ghi đồng thời.

---

## Thư mục `src/evaluation/` — Đánh giá

### `evaluation/metrics.ts` (30 dòng)

**Trách nhiệm:** Tính các chỉ số đánh giá.

**Export:**
- `accuracy(predictions, actuals)` — tỷ lệ dự đoán đúng
- `mcc(predictions, actuals)` — Matthews Correlation Coefficient (-1 → +1)
- `evaluate(predictions, actuals)` — trả `{accuracy, mcc, total, correct}`

---

### `evaluation/backtest.ts` (120 dòng)

**Trách nhiệm:** Chạy backtest rolling-window với online learning.

**Export:**
- `buildEventMemory(client, newsByDate, dates)` — chạy Step 1→2→3 cho danh sách ngày (dùng cho training)
- `buildReflectionMemory(client, labels)` — chạy Step 4 cho mỗi asset × mỗi ngày training
- `runBacktest(client, testNewsByDate, testLabels, testDates)` — chạy pipeline đầy đủ trên test data:
  - Mỗi ngày: Step 1→2→3, rồi Step 6 (gọi Step 5 bên trong)
  - Sau mỗi ngày: cập nhật `actual_direction` + chạy Step 4 online learning
  - Cuối cùng: gọi `evaluate()` cho mỗi asset

**Gọi đến:** Tất cả 6 step + `evaluate` + `insertRawNews` + `computeAndStoreDailyVectors`.

---

## Biểu đồ dòng gọi hàm tổng thể

```
index.ts::main()
│
├── fetchDailyOhlcv()                          [data/price-fetcher]
├── fetchAllNews()                             [data/news-fetcher]
├── generateLabels() + filterTradableDays()    [data/label-generator]
│
├── buildEventMemory()                         [evaluation/backtest]
│   └── for each training day:
│       ├── extractEventsForDay()              [pipeline/step1]
│       │   ├── formatTaxonomyForPrompt()      [data/taxonomy]
│       │   ├── client.generateJson()          [llm/gemini-client]
│       │   ├── parseExtractedEvents()         [llm/response-parser]
│       │   └── encode()                       [embeddings/bge-m3]
│       ├── mergeEventsForDay()                [pipeline/step2]
│       │   ├── clusterEvents()                (nội bộ, dùng cosineSimilarity)
│       │   ├── client.generateJson()          [llm/gemini-client]
│       │   ├── parseMergedEvents()            [llm/response-parser]
│       │   └── encode()                       [embeddings/bge-m3]
│       ├── trackEventsForDay()                [pipeline/step3]
│       │   ├── topKSimilar()                  [embeddings/vector-store]
│       │   ├── client.generateJson()          [llm/gemini-client]
│       │   └── parseTrackResult()             [llm/response-parser]
│       └── computeAndStoreDailyVectors()      [memory/event-memory]
│           └── storeDailyVector()             [memory/similarity]
│
├── buildReflectionMemory()                    [evaluation/backtest]
│   └── for each training day × asset:
│       └── generateReflection()               [pipeline/step4]
│           ├── buildEventSeries()             [memory/event-memory]
│           ├── formatSeriesForPrompt()        [memory/event-memory]
│           ├── client.generateJson()          [llm/gemini-client]
│           ├── parseReasonResult()            [llm/response-parser]
│           └── storeReflection()              [memory/reflection-memory]
│
├── runBacktest()                              [evaluation/backtest]
│   └── for each test day:
│       ├── Step 1-3 (giống trên)
│       └── for each asset:
│           ├── predict()                      [pipeline/step6]
│           │   ├── buildEventSeries()         [memory/event-memory]
│           │   ├── retrieveReferences()       [pipeline/step5]
│           │   │   ├── findTopKSequences()    [memory/similarity]
│           │   │   ├── getReflectionByWindow()[memory/reflection-memory]
│           │   │   ├── client.generateJson()  [llm/gemini-client]
│           │   │   └── parseRetrieveResult()  [llm/response-parser]
│           │   ├── formatReflectionsForPrompt() [memory/reflection-memory]
│           │   ├── client.generateJson()      [llm/gemini-client]
│           │   ├── parsePredictResult()       [llm/response-parser]
│           │   └── insertPrediction()         [storage/database]
│           └── generateReflection()           (online learning)
│
└── evaluate()                                 [evaluation/metrics]
```

---

## Tổng kết số liệu

| Thống kê | Giá trị |
|----------|---------|
| Tổng số file TypeScript | 21 |
| Tổng số file Python | 1 |
| Tổng dòng code (ước tính) | ~1500 dòng (không kèm node_modules) |
| File dài nhất | `storage/database.ts` (266 dòng) |
| File ngắn nhất | `data/label-generator.ts` (30 dòng) |
| Trung bình | ~70 dòng/file |
| Dependencies chính | 7 (Gemini AI, better-sqlite3, ccxt, rss-parser, node-fetch, zod, dotenv) |
| Bảng SQLite | 6 |
| LLM calls mỗi step | 6 loại prompt khác nhau |
