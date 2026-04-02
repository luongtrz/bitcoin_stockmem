# StockMem — Giải thích cho Dev

> Đọc xong file này trong ~5 phút, bạn sẽ hiểu bài báo nói gì và code làm gì.

---

## Một câu tóm tắt

Cho LLM đọc tin tức crypto hàng ngày, **nhớ lại** những lần tình hình tương tự trong quá khứ, rồi dự đoán giá ngày mai lên hay xuống.

---

## Bài toán

**Input:** Tin tức crypto hàng ngày (CoinDesk, CoinTelegraph, CryptoPanic...)
**Output:** Giá BTC/ETH ngày mai sẽ **tăng** hay **giảm**

**Tại sao khó?**
- Tin tức rất nhiễu — hàng trăm bài/ngày, phần lớn không liên quan đến giá
- Cùng 1 sự kiện được nhiều nguồn đưa tin khác nhau
- Tin tốt chưa chắc giá tăng — nếu thị trường đã kỳ vọng rồi thì giá đứng yên
- LLM không có bộ nhớ dài hạn — mỗi lần gọi API là quên hết

---

## Ý tưởng chính: 2 loại "bộ nhớ"

Nghĩ như xây 1 con bot phân tích có **trí nhớ dài hạn**:

### Bộ nhớ 1 — Event Memory (nhớ chuyện gì đã xảy ra)

Giống **database sự kiện có version control**. Không chỉ lưu "hôm nay có gì" mà còn lưu **sự kiện hôm nay liên quan đến sự kiện nào hôm qua** (linked list giữa các ngày).

### Bộ nhớ 2 — Reflection Memory (nhớ kinh nghiệm)

Giống **bảng post-mortem / retrospective**. Sau mỗi ngày giao dịch, nhìn lại: *"tuần trước có sự kiện A, B, C → giá tăng 3% vì lý do X"*. Lưu lại kinh nghiệm này để lần sau gặp tình huống tương tự thì biết.

---

## Pipeline — 6 bước, nghĩ như ETL + RAG

```
 Tin tức ──[ETL]──> Sự kiện có cấu trúc ──[RAG]──> Dự đoán
           Step 1-3                        Step 4-6
```

### Phase 1: ETL — Xây dựng dữ liệu (chạy mỗi ngày)

| Bước | Dev analogy | Mô tả |
|------|-------------|-------|
| **Step 1** | `JSON.parse(news)` | LLM đọc bài báo → trả về JSON sự kiện có cấu trúc (type, entities, description...) |
| **Step 2** | `GROUP BY` + `DISTINCT` | Gộp sự kiện trùng trong ngày. 5 bài về "SEC phê duyệt ETF" → 1 sự kiện |
| **Step 3** | `git diff` giữa hôm nay và hôm qua | Tìm sự kiện hôm qua liên quan → tính "có gì mới?" (ΔInfo) |

### Phase 2: RAG — Dự đoán (chạy khi cần predict)

| Bước | Dev analogy | Mô tả |
|------|-------------|-------|
| **Step 4** | Viết post-mortem | Cho LLM xem sự kiện tuần qua + kết quả giá thực → LLM giải thích tại sao giá lên/xuống |
| **Step 5** | `SELECT * WHERE similar(current, history)` | Tìm trong DB giai đoạn nào giống hiện tại nhất, lấy post-mortem tương ứng |
| **Step 6** | LLM inference với context | Kết hợp: sự kiện gần đây + thông tin mới + kinh nghiệm cũ → dự đoán up/down |

---

## Concept quan trọng nhất: ΔInfo

Đây là ý tưởng **khác biệt nhất** của bài báo, hiểu được cái này là hiểu được paper.

**Vấn đề:** "SEC phê duyệt Bitcoin ETF" là tin tốt. Nhưng giá có tăng không?
- Nếu **không ai ngờ** → giá tăng mạnh (thị trường bất ngờ)
- Nếu **ai cũng biết từ tuần trước** → giá đứng yên hoặc giảm (sell the news)
- Nếu **tuần trước đồn sẽ bị từ chối** → giá tăng cực mạnh (vượt xa kỳ vọng)

**ΔInfo = diff giữa sự kiện hôm nay vs version cũ nhất của nó**

Nghĩ như git diff:
```diff
- SEC đang xem xét đơn ETF (trạng thái cũ)
+ SEC chính thức phê duyệt ETF (trạng thái mới)
# ΔInfo: "Đảo ngược kỳ vọng hoãn, phê duyệt sớm hơn dự kiến"
```

Code thực hiện ở Step 3: tìm sự kiện "cha" trong 5 ngày trước → LLM so sánh → viết ΔInfo.

---

## Retrieval — Tìm kiếm lịch sử tương tự

Giống RAG nhưng thay vì tìm **1 document giống nhất**, tìm **1 chuỗi ngày giống nhất**.

**Cách encode:**
- Mỗi ngày → binary vector 56 chiều (có/không có từng loại sự kiện)
- Giống bloom filter: không lưu nội dung, chỉ lưu "loại gì xuất hiện"

**Cách so sánh:**
- Jaccard similarity giữa 2 ngày (giống tính intersection/union trên 2 Set)
- Similarity chuỗi = trung bình Jaccard trên cả 5 ngày

**2 vòng lọc:**
1. **Vòng 1 (nhanh):** Jaccard trên binary vectors → Top-10 chuỗi ứng viên
2. **Vòng 2 (chính xác):** LLM đọc nội dung sự kiện cụ thể → lọc còn 3-5 chuỗi thực sự giống

Dev analogy: giống **2-phase search** — phase 1 dùng index/bloom filter lọc nhanh, phase 2 dùng full scan trên tập nhỏ.

---

## Tech stack

```
Gemini 2.5 Flash          — LLM cho mọi bước (extract, merge, track, reason, retrieve, predict)
BGE-M3 / MiniLM           — Embedding model (Python subprocess)
SQLite (better-sqlite3)    — Lưu trữ tất cả (events, reflections, predictions)
ccxt                       — Lấy giá BTC/ETH từ Binance
CryptoPanic API + RSS      — Lấy tin tức
Zod                        — Validate JSON trả về từ LLM
TypeScript + tsx            — Runtime
```

---

## Database schema (6 bảng)

```
raw_news          ← tin tức gốc
    ↓
raw_events        ← sự kiện trích xuất (Step 1)
    ↓
merged_events     ← sự kiện gộp + prev_event_id + delta_info (Step 2-3)
    ↓
daily_vectors     ← binary vectors cho Jaccard (Step 5)

reflections       ← post-mortem: "tại sao giá lên/xuống?" (Step 4)

predictions       ← kết quả dự đoán: up/down + lý do (Step 6)
```

---

## Evaluation

- **Accuracy:** % dự đoán đúng hướng (trên 50% = tốt hơn random)
- **MCC:** balanced metric, tránh bias khi dữ liệu lệch (range: -1 → +1, 0 = random)
- **Online learning:** sau mỗi ngày test, thêm reflection mới → bộ nhớ lớn dần → dự đoán cải thiện dần

---

## Mapping paper → code

| Paper | Code | 1 dòng giải thích |
|-------|------|-------------------|
| §3.1.1 LLM_ext | `step1-extract.ts` | Tin tức → JSON sự kiện |
| §3.1.2 LLM_merge | `step2-merge.ts` | Cosine cluster + LLM gộp trùng |
| §3.1.3 LLM_track | `step3-track.ts` | Tìm event cha + tính ΔInfo |
| §3.2 LLM_reason | `step4-reason.ts` | Viết post-mortem với giá thực tế |
| §3.3 Retrieval eq.3-10 | `step5-retrieve.ts` + `similarity.ts` | Jaccard → Top-K → LLM lọc |
| §3.4 LLM_predict eq.11 | `step6-predict.ts` | Sự kiện + ΔInfo + kinh nghiệm → up/down |
| Appendix A | `taxonomy.ts` | 13 nhóm, 56 loại sự kiện crypto |
| Appendix B | `prompts.ts` | Prompt templates cho 6 bước |

---

## TL;DR cho dev

1. **Đọc tin** → trích xuất sự kiện có cấu trúc (LLM)
2. **Gộp trùng** → cosine similarity + LLM merge
3. **Tính diff** → so với hôm qua, cái gì mới? (ΔInfo — concept quan trọng nhất)
4. **Viết post-mortem** → sự kiện tuần qua + giá thực → rút kinh nghiệm
5. **Tìm lịch sử giống** → Jaccard trên binary vectors → LLM lọc
6. **Dự đoán** → sự kiện + diff + kinh nghiệm cũ → up/down

Bản chất: **RAG với bộ nhớ 2 lớp** (sự kiện + kinh nghiệm) chuyên cho dự đoán giá.
