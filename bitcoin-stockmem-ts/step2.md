# Step 2 — Gộp sự kiện (Event Merging)

## Tổng quan

Step 2 nhận danh sách sự kiện thô từ Step 1 và **gộp các sự kiện trùng lặp hoặc nói về cùng một việc** trong cùng ngày. Nhiều bài báo khác nhau có thể đưa tin về cùng 1 sự kiện (VD: 5 nguồn cùng đưa tin SEC phê duyệt ETF), nên cần hợp nhất lại thành 1 sự kiện duy nhất, thông tin đầy đủ hơn.

**Tương ứng bài báo:** Mục 3.1.2 Event Merging, công thức (1), dùng `LLM_merge`

**Chiến lược 2 giai đoạn:** Phân cụm thô bằng véc-tơ (vector clustering) + LLM tinh chỉnh (fine-grained refinement)

```
raw_events (sự kiện thô, nhiều trùng lặp)
    │
    │  1. Nhóm theo event_group
    v
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Regulation   │  │ Macroeconomic│  │ Protocol    │  ...
│ (5 sự kiện)  │  │ (3 sự kiện)  │  │ (4 sự kiện) │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       │  2. Phân cụm bằng cosine similarity
       v                v                v
   [cụm A][cụm B]   [cụm C]        [cụm D][cụm E]
       │                │                │
       │  3. Cụm >1 sự kiện -> gọi LLM gộp
       v                v                v
   (2 merged)       (1 giữ nguyên)  (2 merged)
       │                │                │
       │  4. Tính embedding mới + lưu DB
       v                v                v
                 merged_events
```

---

## Các file liên quan

| File | Vai trò |
|------|---------|
| `src/pipeline/step2-merge.ts` | Logic chính: phân cụm + gọi LLM gộp |
| `src/llm/prompts.ts` | Prompt template (`MERGE_PROMPT`) |
| `src/llm/gemini-client.ts` | Client gọi Gemini API |
| `src/llm/response-parser.ts` | Validate JSON trả về (`MergedEventSchema`) |
| `src/embeddings/bge-m3.ts` | Tính embedding mới cho sự kiện đã gộp |
| `src/embeddings/vector-store.ts` | Hàm `cosineSimilarity()` dùng cho phân cụm |
| `src/storage/database.ts` | Đọc `raw_events`, ghi `merged_events` |
| `src/config.ts` | `CLUSTER_DISTANCE_THRESHOLD = 0.3` |

---

## Đầu vào

- **Bảng `raw_events`** — tất cả sự kiện thô trong cùng ngày (đã có embedding từ Step 1)
- Truy vấn bằng:
  ```sql
  SELECT * FROM raw_events WHERE date = ? ORDER BY id
  ```

---

## Quy trình xử lý chi tiết

### Bước 1: Nhóm sự kiện theo `event_group`

```ts
const byGroup = new Map<string, any[]>();
for (const ev of rawEvents) {
  const group = ev.event_group;
  if (!byGroup.has(group)) byGroup.set(group, []);
  byGroup.get(group)!.push(ev);
}
```

**Tại sao nhóm trước?**
- Chỉ có sự kiện **cùng nhóm** mới có thể là trùng lặp. VD: sự kiện "Regulation" không bao giờ trùng với "Macroeconomic"
- Giảm kích thước bài toán: thay vì so sánh tất cả với tất cả (N²), chỉ so sánh trong từng nhóm
- Đúng theo bài báo — công thức (1): `C_{t,g} = Cluster({v(E) | E ∈ E^raw_{t,g}})`

**Ví dụ:** Ngày 2025-03-15 có 12 sự kiện thô:
- Regulation & Legal: 5 sự kiện (3 về ETF, 2 về lệnh cấm)
- Macroeconomic: 3 sự kiện (đều về lãi suất Fed)
- Protocol & Product: 4 sự kiện (2 về halving, 2 khác nhau)

### Bước 2: Phân cụm bằng cosine similarity (agglomerative clustering - phân cụm kết tụ)

```ts
function clusterEvents(events: Array<{ id: number; embedding: Buffer | null }>): number[][] {
  const embeddings = events.map((ev) =>
    ev.embedding ? bufferToEmbedding(ev.embedding) : new Array(1024).fill(0)
  );

  const n = embeddings.length;
  const assigned = new Array(n).fill(-1);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (assigned[i] !== -1) continue;       // đã thuộc cụm -> bỏ qua
    assigned[i] = clusterId;                // tạo cụm mới với sự kiện i làm "hạt nhân"
    for (let j = i + 1; j < n; j++) {
      if (assigned[j] !== -1) continue;     // đã thuộc cụm -> bỏ qua
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      if (1 - sim < CLUSTER_DISTANCE_THRESHOLD) {  // khoảng cách < 0.3 -> cùng cụm
        assigned[j] = clusterId;
      }
    }
    clusterId++;
  }

  // Chuyển thành danh sách cụm
  const clusters: number[][] = [];
  for (let c = 0; c < clusterId; c++) {
    const members = assigned.map((a, i) => (a === c ? i : -1)).filter((x) => x >= 0);
    if (members.length > 0) clusters.push(members);
  }
  return clusters;
}
```

**Giải thích thuật toán:**

1. Duyệt từng sự kiện `i` từ đầu đến cuối
2. Nếu `i` chưa thuộc cụm nào -> tạo cụm mới, `i` là "hạt nhân" (seed)
3. So sánh `i` với mọi sự kiện `j` phía sau (j > i):
   - Tính cosine similarity (độ tương đồng cosine) giữa embedding `i` và `j`
   - Nếu khoảng cách cosine `(1 - similarity) < 0.3` -> gán `j` vào cùng cụm với `i`
4. Lặp lại cho sự kiện tiếp theo chưa được gán

**Ngưỡng `CLUSTER_DISTANCE_THRESHOLD = 0.3`:**
- Khoảng cách cosine = `1 - cosine_similarity`
- `< 0.3` nghĩa là similarity > 0.7 -> 2 sự kiện khá giống nhau -> gộp lại
- Ngưỡng 0.3 là mức cân bằng: không quá chặt (bỏ sót sự kiện trùng) và không quá lỏng (gộp nhầm sự kiện khác nhau)

**Lưu ý:** Embedding đã được chuẩn hoá L2 từ Step 1 nên `cosineSimilarity()` chỉ cần tính dot product (tích vô hướng):
```ts
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // giả định L2-normalised (đã chuẩn hoá L2)
}
```

**Ví dụ:** 5 sự kiện nhóm "Regulation & Legal":
- Sự kiện 1: "SEC phê duyệt BlackRock ETF" (sim=1.0 với chính nó)
- Sự kiện 2: "SEC chấp thuận Fidelity ETF" (sim=0.85 với SK1 -> cùng cụm)
- Sự kiện 3: "ETF được SEC thông qua" (sim=0.82 với SK1 -> cùng cụm)
- Sự kiện 4: "Trung Quốc cấm mining" (sim=0.25 với SK1 -> cụm mới)
- Sự kiện 5: "Lệnh cấm crypto ở Ấn Độ" (sim=0.78 với SK4 -> cùng cụm SK4)

Kết quả: **Cụm A** = [1, 2, 3] (về ETF), **Cụm B** = [4, 5] (về lệnh cấm)

### Bước 3: Xử lý từng cụm

#### Trường hợp 1: Cụm chỉ có 1 sự kiện -> giữ nguyên, không cần gọi LLM

```ts
if (cluster.length === 1) {
  const ev = cluster[0];
  allMerged.push({
    date,
    asset: ev.asset ?? "ALL",
    event_group: ev.event_group,
    event_type: ev.event_type,
    time: ev.time,
    location: ev.location,
    entities: ev.entities,
    industries: ev.industries,
    description: ev.description,
    source_raw_event_ids: [ev.id],
  });
}
```

Sự kiện được sao chép nguyên sang `merged_events`, chỉ thêm `source_raw_event_ids` để truy vết nguồn gốc.

#### Trường hợp 2: Cụm có > 1 sự kiện -> gọi LLM gộp

**Chuẩn bị dữ liệu cho LLM:**
```ts
const clusterJson = JSON.stringify(
  cluster.map((ev: any) => ({
    id: ev.id,
    event_group: ev.event_group,
    event_type: ev.event_type,
    description: ev.description,
    entities: typeof ev.entities === "string" ? JSON.parse(ev.entities) : ev.entities,
  }))
);
```

Chỉ gửi các trường cần thiết (id, group, type, description, entities) — không gửi embedding hay các trường phụ để tiết kiệm token và giữ prompt ngắn gọn.

**Prompt gửi cho LLM:**

```
You are analyzing a cluster of potentially related cryptocurrency events from
the same day (2025-03-15). Determine:

1. Are these describing the same underlying event, or are they distinct?
2. For events that are the same, merge them into a single unified description.
3. Assign the correct event_type for each resulting event.

Events in cluster:
[
  {"id": 1, "event_group": "Regulation & Legal", "event_type": "Regulatory Announcement",
   "description": "SEC officially approved BlackRock's spot Bitcoin ETF application.",
   "entities": ["SEC", "BlackRock"]},
  {"id": 2, "event_group": "Regulation & Legal", "event_type": "Regulatory Announcement",
   "description": "Fidelity's spot Bitcoin ETF received SEC approval.",
   "entities": ["SEC", "Fidelity"]},
  {"id": 3, "event_group": "Regulation & Legal", "event_type": "Regulatory Announcement",
   "description": "Multiple spot Bitcoin ETFs approved by SEC.",
   "entities": ["SEC", "Bitcoin"]}
]

Output a JSON array of merged events. Each must have:
- event_group: str
- event_type: str
- time: str
- location: str
- entities: list of str
- industries: list of str
- description: str (unified, 2-3 sentences)
- source_event_ids: list of int (which input event IDs were merged)
```

**LLM phân tích và quyết định:**
- 3 sự kiện này đều nói về cùng 1 việc (SEC phê duyệt ETF) -> gộp thành 1
- Tạo mô tả thống nhất, đầy đủ hơn (gồm tên cả BlackRock và Fidelity)
- Có thể phân loại lại event_type nếu thấy cần

**Kết quả trả về từ LLM:**
```json
[
  {
    "event_group": "Regulation & Legal",
    "event_type": "Regulatory Announcement",
    "time": "2025-03-15",
    "location": "US",
    "entities": ["SEC", "BlackRock", "Fidelity", "Bitcoin"],
    "industries": ["cryptocurrency", "asset management"],
    "description": "SEC officially approved multiple spot Bitcoin ETF applications including BlackRock and Fidelity, marking a historic regulatory milestone for the crypto industry.",
    "source_event_ids": [1, 2, 3]
  }
]
```

3 sự kiện thô -> 1 sự kiện gộp, thông tin đầy đủ hơn.

**Parse và validate:**
```ts
const merged = parseMergedEvents(arr);
```

Dùng `MergedEventSchema` (Zod):
```ts
const MergedEventSchema = z.object({
  event_group: z.string(),                          // bắt buộc
  event_type: z.string(),                           // bắt buộc
  time: z.string().default("unknown"),              // mặc định "unknown"
  location: z.string().default("global"),           // mặc định "global"
  entities: z.array(z.string()).default([]),         // mặc định mảng rỗng
  industries: z.array(z.string()).default([]),       // mặc định mảng rỗng
  description: z.string(),                          // bắt buộc
  source_event_ids: z.array(z.number()).default([]), // danh sách ID sự kiện gốc đã gộp
});
```

**Xử lý khi LLM merge thất bại:**
```ts
catch (e: any) {
  console.warn(`Merge failed for ${group} on ${date}: ${e.message}`);
  // Fallback: lấy sự kiện đầu tiên làm đại diện
  const ev = cluster[0];
  allMerged.push({
    date,
    asset: ev.asset ?? "ALL",
    event_group: ev.event_group,
    event_type: ev.event_type,
    description: ev.description,
    source_raw_event_ids: cluster.map((e: any) => e.id), // vẫn giữ liên kết nguồn
  });
}
```

Nếu LLM thất bại, lấy sự kiện đầu tiên trong cụm làm đại diện — không mất dữ liệu, chỉ mất chất lượng gộp.

### Bước 4: Tính embedding mới cho sự kiện đã gộp

```ts
if (allMerged.length > 0) {
  const descriptions = allMerged.map((e) => e.description);
  const embeddings = await encode(descriptions);
  for (let i = 0; i < allMerged.length; i++) {
    allMerged[i].embedding = embeddingToBuffer(embeddings[i]);
  }
  insertMergedEvents(allMerged);
}
```

**Tại sao cần tính embedding mới?**
- Sự kiện đã gộp có `description` mới (do LLM viết lại, đầy đủ hơn) -> embedding cũ không còn đại diện chính xác
- Embedding mới này sẽ được Step 3 (Event Tracking) dùng để tìm sự kiện tiền thân trong lịch sử

### Bước 5: Lưu vào cơ sở dữ liệu

Lưu vào bảng `merged_events`:

```sql
INSERT INTO merged_events
  (date, asset, event_group, event_type, time, location,
   entities, industries, description, extended_attrs, embedding,
   source_raw_event_ids, prev_event_id, chain_depth, delta_info, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Lưu ý:
- `source_raw_event_ids` = JSON array ID sự kiện thô đã gộp, VD: `[1, 2, 3]` — để truy vết nguồn gốc
- `prev_event_id`, `chain_depth`, `delta_info` — để trống, sẽ được Step 3 điền sau

---

## Đầu ra chi tiết

### Bảng `merged_events` trong SQLite (sau Step 2)

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | INTEGER | Khoá chính, tự tăng |
| `date` | TEXT | Ngày sự kiện |
| `asset` | TEXT | Tài sản liên quan |
| `event_group` | TEXT | Nhóm sự kiện |
| `event_type` | TEXT | Loại sự kiện (có thể đã được LLM phân loại lại) |
| `time` | TEXT | Thời gian cụ thể |
| `location` | TEXT | Vị trí địa lý |
| `entities` | TEXT | JSON array thực thể (đã hợp nhất từ nhiều nguồn) |
| `industries` | TEXT | JSON array ngành |
| `description` | TEXT | Mô tả thống nhất (do LLM viết lại nếu gộp) |
| `embedding` | BLOB | Véc-tơ embedding mới tính từ description mới |
| `source_raw_event_ids` | TEXT | JSON array ID raw_events đã gộp, VD: `[1,2,3]` |
| `prev_event_id` | INTEGER | *(trống — Step 3 điền)* |
| `chain_depth` | INTEGER | *(0 — Step 3 điền)* |
| `delta_info` | TEXT | *(null — Step 3 điền)* |
| `created_at` | TEXT | Thời điểm tạo bản ghi |

### Giá trị trả về

Hàm `mergeEventsForDay()` trả về `MergedEventRow[]` — danh sách sự kiện đã gộp. Kèm log:
```
2025-03-15: merged 12 raw -> 7 events
```

---

## Ví dụ minh hoạ đầy đủ

**Đầu vào:** 8 sự kiện thô trong ngày 2025-03-15

| ID | event_group | event_type | description |
|----|-------------|------------|-------------|
| 1 | Regulation & Legal | Regulatory Announcement | SEC approved BlackRock spot BTC ETF |
| 2 | Regulation & Legal | Regulatory Announcement | Fidelity spot BTC ETF gets SEC nod |
| 3 | Regulation & Legal | Regulatory Announcement | Multiple spot Bitcoin ETFs approved |
| 4 | Regulation & Legal | Government Stance | China reiterates crypto mining ban |
| 5 | Macroeconomic | Interest Rate Decision | Fed holds rates steady at 5.25% |
| 6 | Macroeconomic | Interest Rate Decision | Federal Reserve pauses rate hikes |
| 7 | Protocol & Product | Hash Rate Change | BTC hashrate hits 650 EH/s record |
| 8 | Protocol & Product | Supply Dynamics | Bitcoin halving countdown begins |

**Xử lý:**

1. **Nhóm theo group:**
   - Regulation & Legal: [1, 2, 3, 4]
   - Macroeconomic: [5, 6]
   - Protocol & Product: [7, 8]

2. **Phân cụm trong mỗi nhóm:**
   - Regulation: Cụm A = [1, 2, 3] (similarity > 0.7, cùng về ETF), Cụm B = [4] (về lệnh cấm, khác)
   - Macroeconomic: Cụm C = [5, 6] (cùng về lãi suất Fed)
   - Protocol: Cụm D = [7] (về hashrate), Cụm E = [8] (về halving, khác nội dung)

3. **Xử lý từng cụm:**
   - Cụm A [1,2,3]: gọi LLM gộp -> 1 sự kiện thống nhất
   - Cụm B [4]: giữ nguyên
   - Cụm C [5,6]: gọi LLM gộp -> 1 sự kiện thống nhất
   - Cụm D [7]: giữ nguyên
   - Cụm E [8]: giữ nguyên

**Đầu ra:** 5 sự kiện đã gộp (từ 8 sự kiện thô)

| ID | event_group | event_type | description | source_raw_event_ids |
|----|-------------|------------|-------------|---------------------|
| 1 | Regulation & Legal | Regulatory Announcement | SEC approved multiple spot Bitcoin ETFs including BlackRock and Fidelity... | [1, 2, 3] |
| 2 | Regulation & Legal | Government Stance | China reiterates crypto mining ban... | [4] |
| 3 | Macroeconomic | Interest Rate Decision | Federal Reserve holds interest rates steady at 5.25%, pausing rate hikes... | [5, 6] |
| 4 | Protocol & Product | Hash Rate Change | BTC hashrate hits all-time high of 650 EH/s... | [7] |
| 5 | Protocol & Product | Supply Dynamics | Bitcoin halving countdown begins... | [8] |

```
2025-03-15: merged 8 raw -> 5 events
```

---

## Tại sao dùng 2 giai đoạn thay vì chỉ dùng LLM?

| Phương pháp | Ưu điểm | Nhược điểm |
|-------------|---------|------------|
| Chỉ dùng embedding clustering | Nhanh, rẻ, không tốn API call | Có thể gộp nhầm (2 sự kiện tương tự mô tả nhưng khác nội dung) |
| Chỉ dùng LLM | Chính xác cao nhất | Rất tốn API call và token nếu gửi tất cả sự kiện 1 lúc, dễ bị long-context interference (nhiễu ngữ cảnh dài) |
| **2 giai đoạn (code hiện tại)** | **Cân bằng: clustering lọc nhanh, LLM chỉ xử lý cụm nhỏ** | **Phức tạp hơn một chút** |

Đúng theo bài báo mục 3.1.2: *"vector-based coarse clustering + LLM-based fine-grained judgment"* — phân cụm thô bằng véc-tơ + LLM phán đoán tinh.

---

## Xử lý lỗi

| Tình huống | Cách xử lý |
|-----------|------------|
| Không có sự kiện thô trong ngày | Trả về mảng rỗng `[]` |
| Embedding null (sự kiện không có embedding) | Dùng véc-tơ toàn số 0 (1024 chiều) — vẫn phân cụm được nhưng kém chính xác |
| LLM merge thất bại | Lấy sự kiện đầu tiên trong cụm làm đại diện, ghi log cảnh báo |
| JSON parse thất bại | Xử lý bởi `parseJsonResponse()` (3 cách thử) trong Gemini client |
| Sự kiện gộp không pass validate Zod | Bỏ qua sự kiện đó, không crash |

---

## Mối liên kết với các bước khác

| Bước | Mối quan hệ |
|------|-------------|
| **Step 1 -> Step 2** | Step 2 đọc `raw_events` từ Step 1 (theo ngày) |
| **Step 2 -> Step 3** | Step 3 đọc `merged_events` để tìm tiền thân và xây dựng chuỗi sự kiện |
| **Step 2 -> Step 4** | Step 4 đọc `merged_events` để xây dựng chuỗi sự kiện cho reflection |
| **Step 2 -> Step 5** | Step 5 đọc `merged_events` để tạo binary vectors (Jaccard) và so sánh chuỗi |
| **Step 2 -> Step 6** | Step 6 đọc `merged_events` (gián tiếp qua `buildEventSeries()`) để tạo prompt dự đoán |

`merged_events` là **bảng trung tâm** được sử dụng bởi mọi bước từ Step 3 trở đi.
