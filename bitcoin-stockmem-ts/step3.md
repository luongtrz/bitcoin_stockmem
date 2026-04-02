# Step 3 — Theo dõi chuỗi sự kiện (Event Tracking)

## Tổng quan

Step 3 nhận sự kiện đã gộp từ Step 2 và **tìm mối liên kết với các sự kiện trong quá khứ**, xây dựng **chuỗi sự kiện** (event chain) và trích xuất **thông tin gia tăng** (ΔInfo — delta info). Đây là bước then chốt tạo ra sự khác biệt cốt lõi của StockMem so với các framework khác.

**Tương ứng bài báo:** Mục 3.1.3 Event Tracking, công thức (2), dùng `LLM_track`

```
Sự kiện hôm nay                  Sự kiện lịch sử (5 ngày trước)
┌──────────────────┐             ┌──────────────────┐
│ "SEC phê duyệt   │             │ t-3: "SEC xem xét│
│  spot BTC ETF"   │             │      đơn ETF"    │
│  (ngày t)        │             │ t-1: "SEC hoãn   │
└────────┬─────────┘             │      quyết định" │
         │                       └────────┬─────────┘
         │  1. Top-K cosine similarity           │
         │─────────────────────────────────>│
         │  2. LLM xác nhận tiền thân            │
         │<─────────────────────────────────│
         │                                       │
         v                                       v
┌──────────────────────────────────────────────────┐
│ Event Chain (chuỗi sự kiện):                      │
│   t-3: "xem xét" -> t-1: "hoãn" -> t: "phê duyệt"│
│                                                    │
│ ΔInfo: "SEC đảo ngược quyết định hoãn, chính thức │
│         phê duyệt, vượt kỳ vọng thị trường"       │
└──────────────────────────────────────────────────┘
```

---

## Các file liên quan

| File | Vai trò |
|------|---------|
| `src/pipeline/step3-track.ts` | Logic chính: tìm tiền thân + trích ΔInfo |
| `src/llm/prompts.ts` | Prompt template (`TRACK_PROMPT`) |
| `src/llm/gemini-client.ts` | Client gọi Gemini API |
| `src/llm/response-parser.ts` | Validate JSON (`TrackResultSchema`) |
| `src/embeddings/bge-m3.ts` | Chuyển đổi embedding buffer |
| `src/embeddings/vector-store.ts` | `topKSimilar()` — tìm Top-K sự kiện tương tự |
| `src/storage/database.ts` | Đọc/cập nhật `merged_events` |
| `src/config.ts` | `WINDOW_SIZE=5`, `D_MAX=5`, `TOP_K_TRACK=10` |

---

## Đầu vào

- **Sự kiện hôm nay:** truy vấn từ `merged_events` theo ngày hiện tại
  ```sql
  SELECT * FROM merged_events WHERE date = ? ORDER BY id
  ```
- **Sự kiện lịch sử:** trong cửa sổ [t-w, t-1] (w = `WINDOW_SIZE` = 5 ngày)
  ```ts
  const { start, end } = getWindowDates(date, WINDOW_SIZE);
  const histEvents = queryMergedEventsByDateRange(start, end);
  ```

---

## Quy trình xử lý chi tiết

### Bước 1: Xác định cửa sổ thời gian (time window)

```ts
function getWindowDates(date: string, window: number): { start: string; end: string } {
  const dt = new Date(date);
  const startDt = new Date(dt);
  startDt.setDate(startDt.getDate() - window);  // t - 5
  const endDt = new Date(dt);
  endDt.setDate(endDt.getDate() - 1);           // t - 1 (không bao gồm hôm nay)
  return { start, end };
}
```

**Ví dụ:** Hôm nay = 2025-03-20, window = 5
- start = 2025-03-15
- end = 2025-03-19
- Tìm sự kiện lịch sử trong [15/3 → 19/3], không bao gồm ngày 20/3

**Nếu không có sự kiện lịch sử:** Bỏ qua tracking cho ngày này (ghi log và return).

### Bước 2: Xây dựng corpus (kho dữ liệu) embedding từ sự kiện lịch sử

```ts
const corpus: number[][] = [];
const corpusIds: number[] = [];
for (const ev of histEvents) {
  if (ev.embedding) {
    corpus.push(bufferToEmbedding(ev.embedding as Buffer));
    corpusIds.push(ev.id as number);
  }
}
```

Chuyển tất cả embedding từ Buffer sang mảng số (`number[]`), đồng thời lưu ID tương ứng để tra cứu sau.

Ngoài ra, tạo `idToEvent` map để tra nhanh thông tin sự kiện theo ID:
```ts
const idToEvent = new Map<number, any>();
for (const ev of [...histEvents, ...todayEvents]) {
  idToEvent.set(ev.id as number, ev);
}
```

### Bước 3: Với mỗi sự kiện hôm nay — tìm Top-K ứng viên tiền thân

```ts
for (const event of todayEvents) {
  if (!event.embedding || corpus.length === 0) continue;

  const queryEmb = bufferToEmbedding(event.embedding);
  const candidates = topKSimilar(queryEmb, corpus, corpusIds, TOP_K_TRACK);
  // ...
}
```

**`topKSimilar()`** hoạt động:
1. Tính cosine similarity giữa embedding sự kiện hiện tại và mọi embedding trong corpus
2. Sắp xếp theo similarity giảm dần
3. Lấy Top-K (K = 10) ứng viên có điểm cao nhất

```ts
function topKSimilar(query, corpus, corpusIds, k = 10) {
  const scored = corpus.map((vec, i) => ({
    id: corpusIds[i],
    score: cosineSimilarity(query, vec),  // dot product vì đã L2-normalised
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
```

**Tương ứng bài báo — công thức (2):**
```
K = Top-K_{E_hist ∈ E_{[t-w, t-1]}} sim(v(E_{t,i}), v(E_hist))
```

### Bước 4: Chuẩn bị thông tin ứng viên cho LLM

```ts
const candidatesInfo = candidates
  .map((c) => {
    const ev = idToEvent.get(c.id);
    return ev ? {
      id: ev.id,
      date: ev.date,
      event_group: ev.event_group,
      event_type: ev.event_type,
      description: ev.description,
      similarity: Math.round(c.score * 1000) / 1000,  // làm tròn 3 chữ số
    } : null;
  })
  .filter(Boolean);
```

Mỗi ứng viên bao gồm: ID, ngày, nhóm, loại, mô tả, và điểm similarity — đủ thông tin để LLM phán đoán.

### Bước 5: Gọi LLM xác nhận tiền thân + trích ΔInfo

**Prompt gửi cho LLM:**

```
You are tracking the evolution of a cryptocurrency market event. Given the
current event and a list of candidate predecessor events from the past
5 days, determine:

1. Does the current event have a direct predecessor (same underlying event,
   earlier occurrence)?
2. If yes, what is the incremental information (ΔInfo) — new developments
   or changes compared to the predecessor?

Current event (ID=15, date=2025-03-20):
{"event_group": "Regulation & Legal",
 "event_type": "Regulatory Announcement",
 "description": "SEC officially approves multiple spot Bitcoin ETFs..."}

Candidate predecessors:
[
  {"id": 8, "date": "2025-03-18", "event_group": "Regulation & Legal",
   "event_type": "Regulatory Announcement",
   "description": "SEC postpones decision on spot Bitcoin ETF applications...",
   "similarity": 0.872},
  {"id": 5, "date": "2025-03-17", "event_group": "Regulation & Legal",
   "event_type": "Regulatory Announcement",
   "description": "SEC begins reviewing spot Bitcoin ETF applications...",
   "similarity": 0.831},
  {"id": 12, "date": "2025-03-19", "event_group": "Macroeconomic",
   "event_type": "Interest Rate Decision",
   "description": "Fed holds rates steady...",
   "similarity": 0.412},
  ...
]

Output JSON:
{"has_predecessor": true/false, "predecessor_id": <int or null>, "delta_info": "<string or null>"}
```

**LLM phân tích:**
- Ứng viên ID=8 (SEC hoãn quyết định ETF) — cùng chủ đề, cùng nhóm, similarity cao -> **là tiền thân trực tiếp**
- Ứng viên ID=12 (Fed giữ lãi suất) — khác chủ đề hoàn toàn -> **không phải tiền thân**
- ΔInfo: điều gì mới so với tiền thân? "SEC đảo ngược quyết định hoãn, chính thức phê duyệt"

**Kết quả trả về:**
```json
{
  "has_predecessor": true,
  "predecessor_id": 8,
  "delta_info": "SEC reversed its earlier postponement and officially approved multiple spot Bitcoin ETF applications. This exceeded market expectations which had anticipated further delays."
}
```

**Validate bằng Zod:**
```ts
const TrackResultSchema = z.object({
  has_predecessor: z.boolean(),                         // bắt buộc
  predecessor_id: z.number().nullable().default(null),  // ID tiền thân (null nếu không có)
  delta_info: z.string().nullable().default(null),      // thông tin gia tăng (null nếu không có)
});
```

### Bước 6: Tính độ sâu chuỗi (chain depth) và cập nhật DB

```ts
if (track.has_predecessor && track.predecessor_id) {
  // Tính chain depth: đi ngược chuỗi từ tiền thân
  let depth = 0;
  let curId: number | null = track.predecessor_id;
  while (curId && depth < D_MAX) {
    const prev = idToEvent.get(curId);
    if (!prev || !prev.prev_event_id) break;
    curId = prev.prev_event_id;
    depth++;
  }

  // Cập nhật merged_events
  d.prepare(
    "UPDATE merged_events SET prev_event_id = ?, chain_depth = ?, delta_info = ? WHERE id = ?"
  ).run(track.predecessor_id, depth, track.delta_info, event.id);
}
```

**Cách tính chain depth (độ sâu chuỗi):**
- Bắt đầu từ tiền thân (`predecessor_id`)
- Đi ngược chuỗi qua `prev_event_id` cho đến khi:
  - Không còn tiền thân nào nữa, hoặc
  - Đạt `D_MAX = 5` (giới hạn độ sâu)
- Số bước đi ngược = chain depth

**Ví dụ chuỗi:**
```
SK#5 (17/3, xem xét) -> SK#8 (18/3, hoãn) -> SK#15 (20/3, phê duyệt)
     depth=0               depth=1              depth=2
```

SK#15 có `prev_event_id=8`, `chain_depth=1` (vì từ SK#8 đi ngược 1 bước đến SK#5).

**Giới hạn D_MAX = 5:** Theo bài báo, chỉ giữ chuỗi tiến hoá gần đây nhất. Chuỗi quá dài (> 5 bước) thường chứa thông tin cũ, ít giá trị cho dự đoán ngắn hạn.

---

## Đầu ra chi tiết

### Bảng `merged_events` được cập nhật (UPDATE, không INSERT mới)

| Cột được cập nhật | Kiểu | Mô tả |
|-------------------|------|-------|
| `prev_event_id` | INTEGER | ID sự kiện tiền thân trực tiếp (trong `merged_events`) |
| `chain_depth` | INTEGER | Độ sâu chuỗi (0 = không có chuỗi, 1 = có 1 tiền thân phía trước, ...) |
| `delta_info` | TEXT | Thông tin gia tăng: điều mới/khác so với tiền thân, do LLM viết |

**Lưu ý:** Step 3 **không tạo bản ghi mới** — chỉ cập nhật 3 cột trên cho các bản ghi `merged_events` đã có từ Step 2.

---

## ΔInfo là gì và tại sao quan trọng?

**ΔInfo (thông tin gia tăng)** = điều gì **mới/khác** ở sự kiện hiện tại so với sự kiện tiền thân.

**Tại sao quan trọng?** Vì biến động giá phụ thuộc vào **mức độ lệch so với kỳ vọng thị trường**, không chỉ bản chất tốt/xấu của tin:

| Tình huống | Bản chất tin | Kỳ vọng thị trường | ΔInfo | Tác động giá |
|------------|-------------|---------------------|-------|-------------|
| SEC phê duyệt ETF (lần đầu) | Tốt | Không ai ngờ | Tin hoàn toàn mới, vượt xa kỳ vọng | Tăng mạnh |
| SEC phê duyệt ETF (đã đồn từ tuần trước) | Tốt | Đã kỳ vọng sẵn | Chỉ xác nhận điều đã biết, không có gì mới | Tăng nhẹ hoặc đi ngang |
| SEC hoãn ETF (đang kỳ vọng phê duyệt) | Xấu | Thất vọng | Đảo ngược kỳ vọng, xấu hơn dự kiến | Giảm mạnh |
| SEC hoãn ETF (lần thứ 3, ai cũng biết) | Xấu | Đã quen rồi | Lặp lại, không có gì mới | Giảm nhẹ hoặc không đổi |

ΔInfo giúp LLM ở Step 4 và Step 6 hiểu được **"tin này mới đến mức nào"** thay vì chỉ biết **"tin này tốt hay xấu"**.

**Bài báo giải thích (mục 3.1.3):** *"stock price movements depend not only on the absolute sentiment polarity (positive/negative) of information but, more critically, on the magnitude of its deviation from existing market expectations"* — biến động giá phụ thuộc không chỉ vào cực tính cảm xúc tuyệt đối (tích cực/tiêu cực) mà quan trọng hơn là mức độ lệch so với kỳ vọng thị trường hiện tại.

---

## Ví dụ minh hoạ đầy đủ

**Ngày hiện tại:** 2025-03-20, có 3 sự kiện đã gộp (từ Step 2):

| ID | event_group | description |
|----|-------------|-------------|
| 15 | Regulation & Legal | SEC officially approves multiple spot Bitcoin ETFs |
| 16 | Macroeconomic | US CPI comes in at 2.8%, below expectations |
| 17 | Whale & On-chain | Large BTC whale moves 5000 BTC to Coinbase |

**Sự kiện lịch sử [15/3 — 19/3]:**

| ID | date | event_group | description |
|----|------|-------------|-------------|
| 5 | 03-17 | Regulation & Legal | SEC begins reviewing spot Bitcoin ETF applications |
| 8 | 03-18 | Regulation & Legal | SEC postpones decision on spot Bitcoin ETF |
| 9 | 03-18 | Macroeconomic | Market expects CPI around 3.0% |
| 11 | 03-19 | Whale & On-chain | Same whale accumulates 3000 BTC from exchanges |

**Xử lý từng sự kiện hôm nay:**

**SK#15** (SEC phê duyệt ETF):
- Top-K tìm được: ID=8 (sim=0.87), ID=5 (sim=0.83), ...
- LLM xác nhận: tiền thân = SK#8 (SEC hoãn quyết định)
- ΔInfo: "SEC reversed postponement and officially approved ETFs, exceeding market expectations"
- Chain: SK#5 -> SK#8 -> SK#15, depth = 1

**SK#16** (CPI 2.8%):
- Top-K tìm được: ID=9 (sim=0.79), ...
- LLM xác nhận: tiền thân = SK#9 (kỳ vọng CPI 3.0%)
- ΔInfo: "Actual CPI at 2.8% came below the expected 3.0%, signaling cooling inflation"
- Chain: SK#9 -> SK#16, depth = 0

**SK#17** (Whale chuyển BTC vào sàn):
- Top-K tìm được: ID=11 (sim=0.82), ...
- LLM xác nhận: tiền thân = SK#11 (whale mua 3000 BTC)
- ΔInfo: "Same whale now moving 5000 BTC to exchange, reversing from accumulation to potential distribution"
- Chain: SK#11 -> SK#17, depth = 0

**Kết quả cập nhật `merged_events`:**

| ID | prev_event_id | chain_depth | delta_info |
|----|---------------|-------------|------------|
| 15 | 8 | 1 | SEC reversed postponement and officially approved ETFs... |
| 16 | 9 | 0 | Actual CPI at 2.8% came below the expected 3.0%... |
| 17 | 11 | 0 | Same whale now moving 5000 BTC to exchange, reversing... |

---

## Xử lý lỗi

| Tình huống | Cách xử lý |
|-----------|------------|
| Không có sự kiện lịch sử trong cửa sổ | Ghi log, bỏ qua tracking cho ngày này |
| Sự kiện không có embedding | Bỏ qua sự kiện đó (`continue`) |
| Corpus rỗng (không embedding lịch sử nào) | Bỏ qua (`continue`) |
| Top-K không tìm được ứng viên nào | Bỏ qua (`continue`) |
| LLM track thất bại | Ghi log cảnh báo, bỏ qua sự kiện — không cập nhật DB, sự kiện vẫn tồn tại nhưng không có chuỗi |
| LLM trả `has_predecessor: false` | Không cập nhật — sự kiện này hoàn toàn mới, không có tiền thân |

---

## Mối liên kết với các bước khác

| Bước | Mối quan hệ |
|------|-------------|
| **Step 2 -> Step 3** | Step 3 đọc `merged_events` từ Step 2 (ngày hiện tại + lịch sử) |
| **Step 3 -> Step 4** | Step 4 đọc `delta_info` qua `formatSeriesForPrompt(includeDeltaInfo=true)` |
| **Step 3 -> Step 6** | Step 6 đọc `delta_info` khi xây dựng prompt dự đoán — ΔInfo là 1 trong 3 nguồn thông tin chính |

`delta_info` từ Step 3 là **yếu tố then chốt** giúp LLM ở Step 6 hiểu mức độ bất ngờ của tin tức, không chỉ nội dung bề mặt.
