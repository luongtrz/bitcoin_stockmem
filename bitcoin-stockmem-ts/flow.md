# Flow xử lý - Bitcoin StockMem

## Tổng quan

StockMem là framework dự đoán giá crypto dựa trên **bộ nhớ sự kiện kép** (event-reflection dual-layer memory). Quy trình gồm 6 bước, chia thành 2 giai đoạn:

- **Giai đoạn 1 — Xây dựng tri thức** (Knowledge Construction): Step 1-4
- **Giai đoạn 2 — Ứng dụng tri thức** (Knowledge Application): Step 5-6

```
Tin tức crypto ──> [Step 1] Trích xuất ──> [Step 2] Gộp ──> [Step 3] Theo dõi chuỗi
                                                                         │
                   Dữ liệu giá ──> [Step 4] Phản chiếu <───────────────┘
                                        │
                                        v
                                  Reflection Memory
                                        │
                   Sự kiện hiện tại ──> [Step 5] Truy xuất lịch sử tương tự
                                                    │
                                                    v
                                              [Step 6] Dự đoán ──> up/down
```

---

## Step 1 — Trích xuất sự kiện (Event Extraction)

**File:** `src/pipeline/step1-extract.ts`
**LLM call:** `LLM_ext` (Gemini)

**Đầu vào:**
- Tin tức crypto hàng ngày (`NewsArticle[]` từ CryptoPanic + RSS)
- Taxonomy (hệ thống phân loại): 13 nhóm, 56 loại sự kiện

**Xử lý:**
1. Chia tin tức thành batch (lô), mỗi lô 3 bài
2. Gửi mỗi lô cho LLM kèm taxonomy, yêu cầu trích xuất sự kiện có cấu trúc
3. Mỗi sự kiện gồm: event_group (nhóm), event_type (loại), time (thời gian), location (vị trí), entities (thực thể liên quan), industries (ngành), description (mô tả)
4. Tính embedding (véc-tơ biểu diễn ngữ nghĩa) cho mỗi sự kiện bằng BGE-M3

**Đầu ra:**
- Danh sách sự kiện thô (`raw_events`) lưu vào SQLite, mỗi sự kiện có embedding

**Ví dụ:** 1 bài báo "SEC approves spot Bitcoin ETF" -> sự kiện:
```json
{
  "event_group": "Regulation & Legal",
  "event_type": "Regulatory Announcement",
  "entities": ["SEC", "Bitcoin"],
  "description": "SEC officially approves spot Bitcoin ETF applications..."
}
```

---

## Step 2 — Gộp sự kiện (Event Merging)

**File:** `src/pipeline/step2-merge.ts`
**LLM call:** `LLM_merge` (Gemini)

**Đầu vào:**
- Tất cả sự kiện thô trong cùng ngày từ Step 1

**Xử lý — chiến lược 2 giai đoạn "phân cụm thô + LLM tinh chỉnh":**
1. **Nhóm** sự kiện theo `event_group` (chỉ gộp trong cùng nhóm)
2. **Phân cụm thô** (coarse clustering): dùng cosine similarity (độ tương đồng cosine) trên embedding, ngưỡng khoảng cách = 0.3
3. **LLM tinh chỉnh** (fine-grained): với mỗi cụm có > 1 sự kiện, gọi LLM để:
   - Xác nhận các sự kiện có thực sự cùng nói về 1 việc không
   - Tạo mô tả thống nhất cho sự kiện đã gộp
   - Phân loại lại event_type nếu cần
4. Tính embedding mới cho sự kiện đã gộp

**Đầu ra:**
- Danh sách sự kiện đã gộp (`merged_events`) — ít hơn raw_events, thông tin đậm đặc hơn

**Ví dụ:** 5 bài báo cùng nói về "SEC phê duyệt ETF" từ các góc khác nhau -> gộp thành 1 sự kiện duy nhất

---

## Step 3 — Theo dõi chuỗi sự kiện (Event Tracking)

**File:** `src/pipeline/step3-track.ts`
**LLM call:** `LLM_track` (Gemini)

**Đầu vào:**
- Sự kiện đã gộp của ngày hiện tại (từ Step 2)
- Sự kiện lịch sử trong cửa sổ [t-w, t-1] (w = 5 ngày)

**Xử lý — cũng 2 giai đoạn:**
1. **Truy xuất thô** (coarse retrieval): tìm Top-K (K=10) sự kiện lịch sử gần nhất bằng cosine similarity trên embedding
2. **LLM phán đoán** (fine judgment): gọi LLM xác nhận:
   - Sự kiện hiện tại có **tiền thân** (predecessor - sự kiện trước đó cùng chủ đề) không?
   - Nếu có -> liên kết thành **chuỗi sự kiện** (event chain), độ sâu tối đa D_max = 5
   - Trích xuất **ΔInfo** (thông tin gia tăng): điều gì mới/khác so với tiền thân?

**Đầu ra:**
- Cập nhật `merged_events`: thêm `prev_event_id` (ID tiền thân), `chain_depth` (độ sâu chuỗi), `delta_info` (thông tin gia tăng)

**Ví dụ:**
- Ngày 1: "SEC đang xem xét ETF" (sự kiện gốc)
- Ngày 3: "SEC hoãn quyết định ETF" -> tiền thân = ngày 1, ΔInfo = "SEC hoãn thay vì phê duyệt, thị trường thất vọng"
- Ngày 5: "SEC chính thức phê duyệt ETF" -> tiền thân = ngày 3, ΔInfo = "đảo ngược quyết định hoãn, vượt kỳ vọng thị trường"

**Tại sao ΔInfo quan trọng?** Vì biến động giá phụ thuộc vào **mức độ lệch so với kỳ vọng thị trường**, không chỉ bản chất tốt/xấu của tin. Tin tốt nhưng đã được kỳ vọng -> giá không tăng. Tin xấu nhưng ít xấu hơn kỳ vọng -> giá tăng.

---

## Step 4 — Tạo phản chiếu (Reflection Generation)

**File:** `src/pipeline/step4-reason.ts`
**LLM call:** `LLM_reason` (Gemini)

**Đầu vào:**
- Chuỗi sự kiện trong cửa sổ [t-w, t] (bao gồm ΔInfo từ Step 3)
- **Hướng giá thực tế** ngày t+1 (up/down) — chỉ dùng trong training (huấn luyện)

**Xử lý:**
1. Xây dựng chuỗi sự kiện gần đây bằng `buildEventSeries()` (lấy sự kiện w ngày gần nhất)
2. Gửi cho LLM: chuỗi sự kiện + kết quả giá thực tế
3. LLM phân tích: **tại sao giá lên/xuống?** Sự kiện nào gây ra?

**Đầu ra:**
- Lưu vào `reflections` (bộ nhớ phản chiếu):
  - `reason` — lý do giá biến động
  - `key_events` — sự kiện then chốt gây tác động
  - `price_direction` — hướng giá thực tế (up/down)

**Bản chất:** Đây là bước "dạy" cho hệ thống hiểu mối quan hệ nhân quả giữa sự kiện và giá. Giống như một nhà phân tích nhìn lại: "Á, tuần trước giá tăng vì SEC phê duyệt ETF + whale tích lũy mạnh."

**Lưu ý:** Trong giai đoạn test (kiểm thử), sau khi dự đoán xong và biết kết quả thực tế, mẫu đó cũng được phân tích và thêm vào reflection memory -> **bộ nhớ mở rộng động** theo thời gian.

---

## Step 5 — Truy xuất lịch sử tương tự (Historical Sequence Retrieval)

**File:** `src/pipeline/step5-retrieve.ts`
**LLM call:** `LLM_retrieve` (Gemini)

**Đầu vào:**
- Chuỗi sự kiện hiện tại (w ngày gần nhất)
- Toàn bộ lịch sử sự kiện và reflection memory

**Xử lý — 2 giai đoạn truy xuất:**

### Giai đoạn 1: Sàng lọc thô (Coarse Screening) bằng Jaccard

1. **Tạo véc-tơ nhị phân hàng ngày:**
   - Type vector (véc-tơ loại): 56 chiều, mỗi chiều = 1 nếu loại sự kiện đó xuất hiện trong ngày
   - Group vector (véc-tơ nhóm): 13 chiều, mỗi chiều = 1 nếu nhóm đó có sự kiện

2. **Tính độ tương đồng hàng ngày:**
   ```
   DailySim(ngày_A, ngày_B) = 0.7 × Jaccard(type_A, type_B) + 0.3 × Jaccard(group_A, group_B)
   ```

3. **Tính độ tương đồng chuỗi:**
   ```
   SeqSim = trung bình DailySim trên toàn bộ cửa sổ w ngày
   ```

4. Lấy **Top-K** (K=10) chuỗi lịch sử có điểm tương đồng cao nhất

### Giai đoạn 2: Phán đoán tinh (Fine-Grained Judgment) bằng LLM

5. Gửi cho LLM: chuỗi hiện tại + các chuỗi ứng viên (kèm kết quả giá và reflection)
6. LLM lọc lại: chuỗi nào **thực sự** tương tự và có giá trị tham chiếu?

**Đầu ra:**
- Danh sách reflection (phản chiếu) từ các chuỗi lịch sử được chọn — đây là "kinh nghiệm" cho bước dự đoán

---

## Step 6 — Dự đoán (Final Prediction)

**File:** `src/pipeline/step6-predict.ts`
**LLM call:** `LLM_predict` (Gemini)

**Đầu vào — tổng hợp 3 nguồn thông tin:**
1. **Chuỗi sự kiện gần đây** (`Series_current`) — bối cảnh sự kiện w ngày qua
2. **Thông tin gia tăng** (`ΔInfo`) — mức độ lệch so với kỳ vọng thị trường (từ Step 3)
3. **Kinh nghiệm lịch sử** (`Reflection_ref`) — phản ứng thị trường trong tình huống tương tự (từ Step 5)

**Xử lý:**
1. Gọi Step 5 để lấy các reflection tham chiếu
2. Xây dựng prompt kết hợp cả 3 nguồn
3. LLM phân tích và đưa ra dự đoán

**Đầu ra:**
- `predicted_direction` — hướng giá dự đoán: **"up"** hoặc **"down"**
- `reason` — lý do dự đoán (trong 500 từ)
- `reference_reflection_ids` — ID các reflection đã tham chiếu

**Lưu vào:** bảng `predictions` trong SQLite

---

## Tóm tắt dòng dữ liệu

```
Tin tức (CryptoPanic + RSS)
    │
    v
[Step 1] LLM trích xuất -> raw_events (sự kiện thô + embedding)
    │
    v
[Step 2] Phân cụm + LLM gộp -> merged_events (sự kiện đã gộp + embedding)
    │
    v
[Step 3] Top-K cosine + LLM theo dõi -> merged_events + prev_event_id, chain_depth, delta_info
    │
    v
[Step 4] Chuỗi sự kiện + giá thực tế -> LLM phân tích -> reflections (bộ nhớ phản chiếu)
    │
    v
[Step 5] Jaccard trên binary vectors -> Top-K chuỗi ứng viên -> LLM lọc -> reflection tham chiếu
    │
    v
[Step 6] Chuỗi hiện tại + ΔInfo + reflection tham chiếu -> LLM dự đoán -> predictions (up/down + lý do)
```

---

## Các bảng dữ liệu qua từng bước

| Bước | Bảng ghi vào | Trường quan trọng |
|------|-------------|-------------------|
| Step 1 | `raw_events` | event_group, event_type, description, embedding |
| Step 2 | `merged_events` | description, embedding, source_raw_event_ids |
| Step 3 | `merged_events` (cập nhật) | prev_event_id, chain_depth, delta_info |
| Step 4 | `reflections` | price_direction, reason, key_events |
| Step 5 | `daily_vectors` | type_vector, group_vector |
| Step 6 | `predictions` | predicted_direction, reason, reference_reflection_ids |

---

## Tổng số lần gọi LLM

Mỗi ngày giao dịch, pipeline gọi LLM tối đa **6 lần** (tương ứng 6 bước), trong đó:
- Step 1: gọi nhiều lần (1 lần/batch 3 bài báo)
- Step 2: gọi nhiều lần (1 lần/cụm cần gộp)
- Step 3: gọi nhiều lần (1 lần/sự kiện cần theo dõi)
- Step 4: gọi 1 lần (phân tích cả chuỗi)
- Step 5: gọi 1 lần (lọc ứng viên)
- Step 6: gọi 1 lần (dự đoán cuối cùng)

Tất cả đều dùng **Gemini 2.5 Flash**, temperature = 0.0 (tắt tính ngẫu nhiên), rate limit 15 request/phút.
