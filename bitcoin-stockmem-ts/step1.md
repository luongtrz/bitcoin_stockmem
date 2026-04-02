# Step 1 — Trích xuất sự kiện (Event Extraction)

## Tổng quan

Step 1 là bước đầu tiên trong pipeline, chịu trách nhiệm **biến tin tức thô thành sự kiện có cấu trúc**. Đây là nền tảng cho toàn bộ hệ thống — nếu trích xuất sai hoặc thiếu, mọi bước sau đều bị ảnh hưởng.

**Tương ứng bài báo:** Mục 3.1.1 Event Extraction, dùng `LLM_ext`

```
Tin tức thô (text)                          Sự kiện có cấu trúc (structured event)
┌──────────────────────┐                    ┌──────────────────────────────┐
│ "SEC officially       │     LLM_ext       │ event_group: Regulation      │
│  approves spot        │ ──────────────>   │ event_type: Regulatory Ann.  │
│  Bitcoin ETF..."      │  + Taxonomy       │ entities: ["SEC","Bitcoin"]  │
│                       │  + Embedding      │ description: "SEC approved.."│
└──────────────────────┘                    │ embedding: [0.12, -0.03,...] │
                                            └──────────────────────────────┘
```

---

## Các file liên quan

| File | Vai trò |
|------|---------|
| `src/pipeline/step1-extract.ts` | Logic chính của Step 1 |
| `src/llm/prompts.ts` | Prompt template (`EXTRACT_PROMPT`) gửi cho LLM |
| `src/llm/gemini-client.ts` | Client gọi Gemini API |
| `src/llm/response-parser.ts` | Kiểm tra/xác thực (validate) JSON trả về từ LLM bằng Zod |
| `src/data/taxonomy.ts` | Hệ thống phân loại sự kiện (13 nhóm, 56 loại) |
| `src/data/news-fetcher.ts` | Lấy tin tức đầu vào |
| `src/embeddings/bge-m3.ts` | Tính embedding cho mô tả sự kiện |
| `src/embeddings/embed_server.py` | Server Python chạy mô hình embedding |
| `src/storage/database.ts` | Lưu sự kiện vào SQLite (`raw_events`) |

---

## Đầu vào chi tiết

### 1. Tin tức (`NewsArticle[]`)

Lấy từ `news-fetcher.ts`, mỗi bài báo gồm:

```ts
{
  date: string;      // ngày đăng, VD: "2025-03-15"
  title: string;     // tiêu đề bài báo
  url: string;       // đường dẫn gốc
  source: string;    // nguồn tin, VD: "CoinDesk", "cryptopanic"
  asset: string;     // tài sản liên quan: "BTC", "ETH", hoặc "ALL" (tất cả)
  body: string|null; // nội dung bài viết (có thể null nếu chỉ có tiêu đề)
}
```

### 2. Taxonomy (hệ thống phân loại)

Hàm `formatTaxonomyForPrompt()` tạo 2 chuỗi đưa vào prompt:
- `groups` — danh sách 13 nhóm: `"Regulation & Legal, Macroeconomic, ..."`
- `typeList` — danh sách chi tiết loại sự kiện trong mỗi nhóm:
  ```
  Regulation & Legal: Regulatory Announcement, Enforcement Action, ...
  Macroeconomic: Interest Rate Decision, Inflation Data, ...
  ...
  ```

---

## Quy trình xử lý chi tiết

### Bước 1: Chia batch (lô)

```ts
const BATCH_SIZE = 3;
for (let i = 0; i < articles.length; i += BATCH_SIZE) {
  const batch = articles.slice(i, i + BATCH_SIZE);
  // ...
}
```

Tin tức được chia thành từng lô **3 bài** một. Lý do:
- Gửi quá nhiều bài 1 lần -> prompt quá dài, LLM mất tập trung, chất lượng trích xuất giảm
- Gửi từng bài 1 -> tốn quá nhiều API call (lãng phí quota, chậm)
- 3 bài là mức cân bằng giữa chất lượng và hiệu suất

### Bước 2: Xây dựng prompt

Với mỗi batch, tạo đoạn text mô tả các bài báo:

```ts
let articlesText = "";
for (const [idx, art] of batch.entries()) {
  const body = art.body || art.title;           // nếu không có body, dùng title
  articlesText += `\n--- Article ${idx + 1} (source: ${art.source}) ---\n`;
  articlesText += `Title: ${art.title}\n`;
  if (body !== art.title) articlesText += `Content: ${body.slice(0, 2000)}\n`;
  //                                                      ^^^^^^^^
  //                                          cắt nội dung tối đa 2000 ký tự
}
```

Sau đó ghép vào template `EXTRACT_PROMPT`:

```
You are a cryptocurrency market analyst. Extract all distinct events from the
following news article(s) related to cryptocurrency markets.

For each event, output a JSON object with these fields:
- event_group: one of [Regulation & Legal, Macroeconomic, ...]
- event_type: the specific type within that group (see list below)
- time: when the event occurred (YYYY-MM-DD or "unknown")
- location: country/region or "global"
- entities: list of participating entities (companies, protocols, people)
- industries: list of relevant sectors
- description: 2-3 sentence factual summary of the event

Valid event types per group:
  Regulation & Legal: Regulatory Announcement, Enforcement Action, ...
  Macroeconomic: Interest Rate Decision, Inflation Data, ...
  ...

=== News Article(s) ===
--- Article 1 (source: CoinDesk) ---
Title: SEC Approves Spot Bitcoin ETF
Content: The U.S. Securities and Exchange Commission has officially...

--- Article 2 (source: CoinTelegraph) ---
Title: Bitcoin Surges Past $50K After ETF Approval
Content: Bitcoin price jumped 8% following...

Output a JSON array of event objects. If no relevant crypto events, output [].
```

### Bước 3: Gọi LLM (Gemini)

```ts
const result = await client.generateJson(prompt);
```

Chi tiết bên trong `GeminiClient`:
- **Mô hình:** Gemini 2.5 Flash
- **Temperature:** 0.0 (tắt hoàn toàn tính ngẫu nhiên — luôn cho kết quả ổn định nhất)
- **Chế độ đầu ra:** JSON mode (`responseMimeType: "application/json"`) — Gemini bắt buộc trả về JSON hợp lệ
- **Rate limiting (giới hạn tốc độ):** tối đa 15 request/phút, tự động chờ nếu gọi quá nhanh
- **Retry (thử lại):** tối đa 3 lần nếu thất bại, mỗi lần chờ lâu hơn (4s, 8s, 12s — exponential backoff)

### Bước 4: Parse JSON trả về (phân tích cú pháp)

Gemini trả về JSON, nhưng đôi khi không hoàn hảo. `parseJsonResponse()` thử 3 cách:
1. Parse trực tiếp bằng `JSON.parse()`
2. Tìm markdown fence (khối code) `` ```json ... ``` `` rồi parse
3. Tìm cặp `{ }` hoặc `[ ]` đầu tiên trong text rồi parse

### Bước 5: Xác thực bằng Zod schema

```ts
const events = parseExtractedEvents(arr);
```

Mỗi sự kiện được kiểm tra qua `ExtractedEventSchema`:

```ts
const ExtractedEventSchema = z.object({
  event_group: z.string(),                            // bắt buộc
  event_type: z.string(),                             // bắt buộc
  time: z.string().default("unknown"),                // mặc định "unknown"
  location: z.string().default("global"),             // mặc định "global"
  entities: z.array(z.string()).default([]),           // mặc định mảng rỗng
  industries: z.array(z.string()).default([]),         // mặc định mảng rỗng
  description: z.string(),                            // bắt buộc
  extended_attrs: z.record(z.unknown()).optional(),    // tuỳ chọn
});
```

**Quan trọng:** Nếu sự kiện nào không pass validate (VD: thiếu `description`) -> bị bỏ qua (trả về `null`, lọc ra bởi `.filter()`). Không làm crash toàn bộ batch.

### Bước 6: Tạo đối tượng `RawEventRow`

```ts
for (const ev of events) {
  allEvents.push({
    news_id: null,
    date,                             // ngày của batch tin tức
    asset: batch[0].asset || "ALL",   // lấy asset từ bài báo đầu tiên
    event_group: ev.event_group,      // VD: "Regulation & Legal"
    event_type: ev.event_type,        // VD: "Regulatory Announcement"
    time: ev.time,                    // VD: "2025-03-15" hoặc "unknown"
    location: ev.location,            // VD: "US" hoặc "global"
    entities: ev.entities,            // VD: ["SEC", "BlackRock", "Bitcoin"]
    industries: ev.industries,        // VD: ["cryptocurrency", "finance"]
    description: ev.description,      // VD: "SEC officially approved..."
    extended_attrs: ev.extended_attrs, // thuộc tính mở rộng tuỳ ngữ cảnh
  });
}
```

### Bước 7: Tính embedding (véc-tơ biểu diễn ngữ nghĩa)

```ts
const descriptions = allEvents.map((e) => e.description);
const embeddings = await encode(descriptions);
for (let i = 0; i < allEvents.length; i++) {
  allEvents[i].embedding = embeddingToBuffer(embeddings[i]);
}
```

**Mô hình embedding:**
- Có GPU: **BAAI/bge-m3** — mô hình embedding đa ngôn ngữ mạnh, 1024 chiều
- Không có GPU: **all-MiniLM-L6-v2** — mô hình nhẹ hơn, 384 chiều (fallback dự phòng)

**Cách hoạt động:**
- TypeScript gọi Python subprocess (tiến trình con) chạy `embed_server.py`
- 2 chế độ:
  - **Server mode (chế độ server):** Python chạy liên tục, nhận text qua stdin (đầu vào chuẩn), trả embedding qua stdout (đầu ra chuẩn) — nhanh vì không cần load lại mô hình
  - **One-shot mode (chế độ chạy 1 lần, dự phòng):** mỗi lần gọi spawn (khởi tạo) process mới — chậm hơn nhưng đơn giản hơn
- Embedding được chuẩn hoá L2 (`normalize_embeddings=True`) -> cosine similarity chỉ cần tính dot product (tích vô hướng)

**Lưu trữ:** Embedding được chuyển thành `Buffer` (mảng byte Float32) để lưu vào cột BLOB trong SQLite.

### Bước 8: Lưu vào cơ sở dữ liệu

```ts
const ids = insertRawEvents(events);
```

Lưu vào bảng `raw_events` trong SQLite, dùng transaction (giao dịch) để đảm bảo tính toàn vẹn:

```sql
INSERT INTO raw_events
  (news_id, date, asset, event_group, event_type, time, location,
   entities, industries, description, extended_attrs, embedding, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Các trường mảng (`entities`, `industries`) được `JSON.stringify()` trước khi lưu.

---

## Đầu ra chi tiết

### Bảng `raw_events` trong SQLite

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | INTEGER | Khoá chính, tự tăng |
| `news_id` | INTEGER | ID bài báo gốc (hiện để null) |
| `date` | TEXT | Ngày sự kiện, VD: "2025-03-15" |
| `asset` | TEXT | Tài sản liên quan: "BTC", "ETH", "ALL" |
| `event_group` | TEXT | Nhóm sự kiện (1 trong 13 nhóm) |
| `event_type` | TEXT | Loại sự kiện (1 trong 56 loại) |
| `time` | TEXT | Thời gian cụ thể hoặc "unknown" |
| `location` | TEXT | Vị trí địa lý hoặc "global" |
| `entities` | TEXT | JSON array thực thể liên quan |
| `industries` | TEXT | JSON array ngành liên quan |
| `description` | TEXT | Mô tả 2-3 câu, tóm tắt sự kiện |
| `extended_attrs` | TEXT | JSON object thuộc tính mở rộng |
| `embedding` | BLOB | Véc-tơ embedding dạng Float32 buffer |
| `created_at` | TEXT | Thời điểm tạo bản ghi |

### Giá trị trả về cho pipeline

Hàm `runExtraction()` trả về `Record<string, number[]>` — map từ ngày -> danh sách ID sự kiện đã lưu:

```ts
{
  "2025-03-15": [1, 2, 3, 4],    // 4 sự kiện trong ngày này
  "2025-03-16": [5, 6],          // 2 sự kiện
  "2025-03-17": [7, 8, 9],       // 3 sự kiện
}
```

Các ID này được Step 2 dùng để truy vấn `raw_events` và thực hiện gộp sự kiện.

---

## Xử lý lỗi

| Tình huống | Cách xử lý |
|-----------|------------|
| Gemini API thất bại | Retry tối đa 3 lần với exponential backoff (chờ lâu dần: 4s, 8s, 12s) |
| JSON parse thất bại | Thử 3 cách parse (trực tiếp, markdown fence, tìm cặp ngoặc) |
| Sự kiện không hợp lệ | Bỏ qua sự kiện đó (Zod filter), không crash batch |
| Cả batch thất bại | `console.warn()` rồi bỏ qua batch, tiếp tục batch kế tiếp |
| Embedding server timeout | Chuyển sang one-shot mode (chế độ chạy đơn lẻ) |
| Embedding hoàn toàn thất bại | Trả về véc-tơ toàn số 0 (zero vector) — sự kiện vẫn được lưu, chỉ mất khả năng so sánh ngữ nghĩa |

---

## Ví dụ minh hoạ đầy đủ

**Đầu vào:** 2 bài báo ngày 2025-03-15

```
--- Article 1 (source: CoinDesk) ---
Title: SEC Approves Spot Bitcoin ETF Applications
Content: The U.S. Securities and Exchange Commission has officially approved
multiple spot Bitcoin ETF applications, including those from BlackRock and
Fidelity. This marks a historic moment for the crypto industry...

--- Article 2 (source: CoinTelegraph) ---
Title: Bitcoin Hashrate Hits All-Time High Ahead of Halving
Content: Bitcoin's network hashrate has surged to a new record of 650 EH/s
as miners ramp up operations ahead of the upcoming halving event...
```

**Đầu ra từ LLM (sau khi parse + validate):**

```json
[
  {
    "event_group": "Regulation & Legal",
    "event_type": "Regulatory Announcement",
    "time": "2025-03-15",
    "location": "US",
    "entities": ["SEC", "BlackRock", "Fidelity", "Bitcoin"],
    "industries": ["cryptocurrency", "asset management"],
    "description": "SEC officially approved multiple spot Bitcoin ETF applications including BlackRock and Fidelity. This is a historic regulatory milestone for the crypto industry."
  },
  {
    "event_group": "Protocol & Product",
    "event_type": "Hash Rate Change",
    "time": "2025-03-15",
    "location": "global",
    "entities": ["Bitcoin"],
    "industries": ["cryptocurrency", "mining"],
    "description": "Bitcoin network hashrate surged to all-time high of 650 EH/s as miners increase operations ahead of the upcoming halving event."
  }
]
```

**Sau khi tính embedding và lưu vào DB:**

| id | date | asset | event_group | event_type | description | embedding |
|----|------|-------|-------------|------------|-------------|-----------|
| 1 | 2025-03-15 | BTC | Regulation & Legal | Regulatory Announcement | SEC officially approved... | `<Float32 buffer 1024 chiều>` |
| 2 | 2025-03-15 | BTC | Protocol & Product | Hash Rate Change | Bitcoin network hashrate... | `<Float32 buffer 1024 chiều>` |

Hai sự kiện này sẽ được Step 2 đọc ra để kiểm tra xem có cần gộp với sự kiện nào khác trong cùng ngày không.
