# Step 4 — Tạo phản chiếu (Reflection Generation)

## Tổng quan

Step 4 là bước **"dạy" hệ thống hiểu mối quan hệ nhân quả** giữa chuỗi sự kiện và biến động giá. Cho LLM xem chuỗi sự kiện gần đây + kết quả giá **thực tế** ngày mai, yêu cầu LLM phân tích: **tại sao giá lên/xuống? Sự kiện nào gây ra?** Kết quả được lưu thành "kinh nghiệm" (reflection) để Step 5 và Step 6 tham chiếu sau.

**Tương ứng bài báo:** Mục 3.2 Reflection Memory, dùng `LLM_reason`

```
Chuỗi sự kiện [t-5, t]              Hướng giá thực tế (t+1)
┌───────────────────────┐            ┌─────────────┐
│ t-5: Fed tăng lãi suất│            │  Giá: DOWN  │
│ t-3: SEC hoãn ETF     │            │  (-3.2%)    │
│ t-1: Whale bán 5K BTC │            └──────┬──────┘
│ t:   Tether in $1B    │                   │
│   ΔInfo: vượt kỳ vọng │                   │
└───────────┬───────────┘                   │
            │                               │
            v                               v
        ┌───────────────────────────────────────┐
        │           LLM_reason (Gemini)          │
        │                                        │
        │  "Tại sao giá giảm?"                   │
        │  -> Lãi suất tăng + SEC hoãn ETF       │
        │     gây áp lực bán. Whale bán lớn      │
        │     kích hoạt thanh lý. Tether in       │
        │     không đủ bù đắp tâm lý tiêu cực.  │
        └───────────────┬───────────────────────┘
                        │
                        v
              ┌──────────────────┐
              │   reflections    │
              │  (bộ nhớ phản    │
              │   chiếu)         │
              │                  │
              │ reason + key_events│
              │ + price_direction │
              └──────────────────┘
```

---

## Các file liên quan

| File | Vai trò |
|------|---------|
| `src/pipeline/step4-reason.ts` | Logic chính: xây dựng chuỗi sự kiện + gọi LLM phân tích |
| `src/llm/prompts.ts` | Prompt template (`REASON_PROMPT`) |
| `src/llm/gemini-client.ts` | Client gọi Gemini API |
| `src/llm/response-parser.ts` | Validate JSON (`ReasonResultSchema`) |
| `src/memory/event-memory.ts` | `buildEventSeries()`, `formatSeriesForPrompt()` — xây dựng và format chuỗi sự kiện |
| `src/memory/reflection-memory.ts` | `storeReflection()` — lưu kết quả phân tích |
| `src/storage/database.ts` | Ghi vào bảng `reflections` |
| `src/config.ts` | `WINDOW_SIZE = 5` |

---

## Đầu vào

### 1. Chuỗi sự kiện gần đây (từ Event Memory)

Xây dựng bằng `buildEventSeries()`:
```ts
const { dates, eventsPerDay } = buildEventSeries(date, WINDOW_SIZE, asset);
```

Hàm này:
1. Tạo danh sách ngày từ `t-5` đến `t` (6 ngày)
2. Với mỗi ngày, truy vấn `merged_events` (bao gồm `delta_info` từ Step 3)
3. Trả về: `dates[]` + `eventsPerDay[][]`

Sau đó format thành text bằng `formatSeriesForPrompt()`:
```ts
const information = formatSeriesForPrompt(dates, eventsPerDay, true);
//                                                               ^^^^
//                                                    includeDeltaInfo = true
```

**Kết quả format:**
```
=== 2025-03-15 ===
  [Macroeconomic / Interest Rate Decision] Fed raises interest rates by 25bps
    ΔInfo: Rate increase was expected but magnitude exceeded consensus forecast
  [Regulation & Legal / Regulatory Announcement] SEC postpones ETF decision
    ΔInfo: Third consecutive delay, market had priced in approval

=== 2025-03-17 ===
  [Whale & On-chain / Whale Distribution] Large whale sells 5000 BTC on Coinbase
    ΔInfo: Same whale was accumulating last week, sudden reversal signals bearish shift
  ...
```

Mỗi sự kiện hiển thị `[nhóm / loại] mô tả` và nếu có ΔInfo thì in thêm dòng `ΔInfo:`.

### 2. Hướng giá thực tế ngày t+1

- Đã biết trước từ dữ liệu giá (`price-fetcher.ts` + `label-generator.ts`)
- Giá trị: `"up"` hoặc `"down"`
- Chỉ dùng trong **training** (huấn luyện) — vì cần biết kết quả thực để "dạy" hệ thống

### 3. Asset (tài sản)

`"BTC"` hoặc `"ETH"`

---

## Quy trình xử lý chi tiết

### Bước 1: Xây dựng chuỗi sự kiện

```ts
const { dates, eventsPerDay } = buildEventSeries(date, WINDOW_SIZE, asset);
const information = formatSeriesForPrompt(dates, eventsPerDay, true);
```

Nếu không có sự kiện nào (`information` rỗng) -> trả về `null`, bỏ qua.

### Bước 2: Tạo prompt

```ts
const prompt = fillTemplate(REASON_PROMPT, {
  asset,                    // VD: "BTC"
  information,              // chuỗi sự kiện đã format
  price_change: priceDirection,  // VD: "down"
});
```

**Prompt đầy đủ:**

```
You are a cryptocurrency analyst specializing in BTC. You need to interpret
the driving factors behind tomorrow's price movement based on the following
analytical elements.

Analytical Elements: Recent event sequence and today's incremental information.

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

=== Events and Incremental Information ===
=== 2025-03-15 ===
  [Macroeconomic / Interest Rate Decision] Fed raises interest rates by 25bps
    ΔInfo: Rate increase exceeded consensus forecast
  [Regulation & Legal / Regulatory Announcement] SEC postpones ETF decision
    ΔInfo: Third consecutive delay
...

=== Actual Direction of Tomorrow's Price Change ===
down

Please analyze the basis for the price change based on the given events and
incremental information (within 500 words) and specify which events
contributed to the price change (within 300 words).

Output strictly in the following JSON format:
{"Reason for price movement": "...", "Events causing the impact": "..."}
```

**Điểm quan trọng trong prompt:**
- Giải thích logic ΔInfo cho LLM: *"Price movements depend not only on the absolute nature of the information but also on the degree of deviation from market expectations"*
- Giới hạn 500 từ cho lý do + 300 từ cho sự kiện then chốt — tránh LLM viết quá dài, giữ reflection ngắn gọn và dễ dùng lại
- Cho LLM biết **kết quả thực tế** (giá giảm) để LLM phân tích ngược lại (hindsight analysis - phân tích nhìn lại)

### Bước 3: Gọi LLM và parse kết quả

```ts
const result = await client.generateJson(prompt);
const parsed = parseReasonResult(result);
```

**Validate bằng Zod:**
```ts
const ReasonResultSchema = z.object({
  "Reason for price movement": z.string(),   // bắt buộc: lý do giá biến động
  "Events causing the impact": z.string(),   // bắt buộc: sự kiện then chốt
});
```

**Kết quả mẫu từ LLM:**
```json
{
  "Reason for price movement": "BTC price declined due to a combination of hawkish monetary policy and regulatory uncertainty. The Fed's rate hike exceeded market expectations, strengthening the dollar and reducing risk appetite. SEC's third consecutive ETF postponement eroded investor confidence. The large whale selling 5000 BTC on Coinbase triggered cascading liquidations in the futures market. While Tether minted $1B USDT suggesting potential buying pressure, this was insufficient to offset the bearish sentiment from macro headwinds and regulatory setbacks.",

  "Events causing the impact": "Primary: Fed interest rate hike exceeding consensus (ΔInfo indicates larger than expected increase). Secondary: SEC ETF postponement (ΔInfo shows repeated delays building frustration). Catalyst: Whale distribution of 5000 BTC (ΔInfo reveals reversal from accumulation, signaling loss of confidence from large holders)."
}
```

### Bước 4: Lưu reflection vào cơ sở dữ liệu

```ts
const refId = storeReflection({
  date,                                               // ngày phân tích
  asset,                                              // "BTC" hoặc "ETH"
  windowStart: dates[0],                              // ngày đầu cửa sổ
  windowEnd: dates[dates.length - 1],                 // ngày cuối cửa sổ
  priceDirection,                                     // "up" hoặc "down"
  reason: parsed["Reason for price movement"],        // lý do giá biến động
  keyEvents: parsed["Events causing the impact"],     // sự kiện then chốt
  priceChangePct,                                     // % thay đổi giá (tuỳ chọn)
  source,                                             // "train" hoặc "test"
});
```

Lưu vào bảng `reflections`:
```sql
INSERT INTO reflections
  (date, asset, window_start, window_end, price_direction,
   price_change_pct, reason, key_events, source, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

---

## Đầu ra chi tiết

### Bảng `reflections` trong SQLite

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | INTEGER | Khoá chính, tự tăng |
| `date` | TEXT | Ngày phân tích (ngày t, giá được dự đoán cho t+1) |
| `asset` | TEXT | Tài sản: "BTC" hoặc "ETH" |
| `window_start` | TEXT | Ngày bắt đầu cửa sổ sự kiện |
| `window_end` | TEXT | Ngày kết thúc cửa sổ sự kiện |
| `price_direction` | TEXT | Hướng giá thực tế: "up" hoặc "down" |
| `price_change_pct` | REAL | Phần trăm thay đổi giá (tuỳ chọn, VD: -0.032) |
| `reason` | TEXT | Lý do giá biến động (do LLM viết, tối đa ~500 từ) |
| `key_events` | TEXT | Sự kiện then chốt gây tác động (do LLM viết, tối đa ~300 từ) |
| `source` | TEXT | Nguồn gốc: "train" (huấn luyện) hoặc "test" (kiểm thử) |
| `created_at` | TEXT | Thời điểm tạo bản ghi |

### Giá trị trả về

Hàm `generateReflection()` trả về `number | null` — ID của reflection đã lưu, hoặc `null` nếu thất bại.

---

## Training vs Test — hai cách dùng khác nhau

### Giai đoạn Training (huấn luyện)

- **Đầu vào:** chuỗi sự kiện + **giá thực tế đã biết**
- **Mục đích:** xây dựng kho kinh nghiệm ban đầu
- **source = "train"**
- Chạy cho toàn bộ tập huấn luyện — mỗi ngày giao dịch tạo 1 reflection

### Giai đoạn Test (kiểm thử)

- **Trước khi dự đoán:** Step 5 + Step 6 dùng reflection có sẵn để tham chiếu
- **Sau khi biết kết quả thực tế:** chạy Step 4 thêm 1 lần cho ngày vừa dự đoán
- **source = "test"**
- **Bộ nhớ mở rộng động:** reflection mới được thêm vào kho -> các dự đoán sau có thêm kinh nghiệm

Đúng theo bài báo: *"After prediction, the sample is analyzed by the model together with its true label and incorporated into the knowledge bank, achieving dynamic expansion of the knowledge base"* — Sau khi dự đoán, mẫu được phân tích cùng nhãn thực và đưa vào kho tri thức, đạt mở rộng động cơ sở tri thức.

---

## Ví dụ minh hoạ đầy đủ

**Đầu vào:**
- asset = "BTC"
- date = "2025-03-20"
- priceDirection = "up" (+2.1%)
- window = 5 ngày [15/3 — 20/3]

**Chuỗi sự kiện (format):**
```
=== 2025-03-16 ===
  [Macroeconomic / Inflation Data] US CPI drops to 2.5%
    ΔInfo: Lower than expected 2.8%, signaling faster disinflation

=== 2025-03-18 ===
  [Regulation & Legal / Regulatory Announcement] SEC approves spot Bitcoin ETFs
    ΔInfo: Reversed previous postponement, exceeded market expectations
  [Market Performance / ETF Flow] BlackRock BTC ETF sees $500M inflow on day one
    ΔInfo: Largest single-day crypto ETF inflow ever recorded

=== 2025-03-20 ===
  [Partnership & Adoption / Institutional Adoption] Goldman Sachs announces BTC custody
    ΔInfo: First major US bank to offer BTC custody, significant institutional milestone
```

**Kết quả reflection lưu vào DB:**

| Trường | Giá trị |
|--------|---------|
| date | 2025-03-20 |
| asset | BTC |
| window_start | 2025-03-15 |
| window_end | 2025-03-20 |
| price_direction | up |
| price_change_pct | 0.021 |
| reason | BTC price rose driven by a convergence of bullish catalysts. The CPI data coming in below expectations reduced pressure for further rate hikes, creating a risk-on environment. SEC's ETF approval was the primary catalyst, with BlackRock's $500M day-one inflow demonstrating unprecedented institutional demand. Goldman Sachs announcing BTC custody further validated institutional adoption. The ΔInfo across events consistently exceeded market expectations, creating cumulative positive surprise. |
| key_events | Primary: SEC spot Bitcoin ETF approval (ΔInfo: reversed postponement). Secondary: BlackRock $500M ETF inflow (ΔInfo: record-breaking). Supporting: CPI below expectations (ΔInfo: faster disinflation) and Goldman Sachs custody announcement (ΔInfo: first major US bank). |
| source | train |

Reflection này sẽ được Step 5 tìm ra khi gặp chuỗi sự kiện tương tự trong tương lai (VD: cũng có ETF + institutional adoption + CPI tích cực).

---

## Xử lý lỗi

| Tình huống | Cách xử lý |
|-----------|------------|
| Không có sự kiện trong cửa sổ | Ghi log cảnh báo, trả về `null` |
| LLM thất bại (API error) | Ghi log cảnh báo, trả về `null` — không lưu reflection lỗi |
| JSON parse thất bại | Xử lý bởi Gemini client (3 cách parse) |
| Kết quả không pass Zod validate | Ném lỗi, bắt bởi try/catch -> trả về `null` |

---

## Mối liên kết với các bước khác

| Bước | Mối quan hệ |
|------|-------------|
| **Step 3 -> Step 4** | Step 4 đọc `delta_info` trong `merged_events` qua `formatSeriesForPrompt(includeDeltaInfo=true)` |
| **Step 4 -> Step 5** | Step 5 đọc bảng `reflections` để tìm kinh nghiệm lịch sử tương tự |
| **Step 4 -> Step 6** | Step 6 dùng reflection (gián tiếp qua Step 5) làm 1 trong 3 nguồn thông tin dự đoán |

Reflection Memory là **cầu nối** giữa giai đoạn xây dựng tri thức (Step 1-3) và giai đoạn ứng dụng tri thức (Step 5-6). Nó biến dữ liệu sự kiện + kết quả giá thành **kinh nghiệm có thể tái sử dụng**.
