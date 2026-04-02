# StockMem — Hiểu sâu hơn, vẫn dễ đọc

> Bản này dành cho dev đã đọc `simple.md` và muốn hiểu **tại sao** thiết kế như vậy, không chỉ **cái gì**.
> Đọc ~15 phút.

---

## Vấn đề thực sự mà paper giải quyết

Hầu hết hệ thống LLM dự đoán giá hiện tại làm thế này:

```
Tin tức hôm nay → LLM → "up" / "down"
```

**3 vấn đề lớn:**

### 1. Không có trí nhớ

Mỗi lần gọi LLM là 1 session mới. Hôm qua đã phân tích "SEC xem xét ETF", hôm nay lại phân tích lại từ đầu. Giống dev không có git history — mỗi ngày mở code lên không biết hôm qua mình đã sửa gì.

**StockMem giải quyết:** Xây 2 bảng DB bền vững:
- `merged_events` = git log của thị trường (mỗi commit là 1 sự kiện, có parent link)
- `reflections` = wiki nội bộ ghi lại bài học kinh nghiệm

### 2. Không phân biệt được "tin mới" vs "tin cũ nhai lại"

LLM đọc "SEC phê duyệt ETF" lần nào cũng đánh giá tích cực. Nhưng nếu tin này đã bị leak từ tuần trước thì thị trường đã price-in rồi — giá sẽ không tăng nữa.

**StockMem giải quyết:** ΔInfo — so sánh sự kiện hôm nay với version cũ (Step 3), chỉ đưa **phần khác biệt** cho LLM, không đưa toàn bộ.

### 3. Không biết "lần trước tình huống này giá đi thế nào"

LLM không có context lịch sử ngoài training data. Nó không biết rằng 3 tháng trước cũng có tình huống "CPI tốt + ETF + institutional buying" và lúc đó giá tăng 5%.

**StockMem giải quyết:** Retrieval (Step 5) — tìm giai đoạn tương tự trong quá khứ, lấy post-mortem đính kèm gửi cho LLM.

---

## Step 1 — Extract: Tại sao cần Taxonomy?

```
Tin tức (text tự do) → LLM + Taxonomy → JSON có cấu trúc
```

**Không có taxonomy:** LLM tự do đặt tên. Cùng 1 sự kiện có thể thành:
```json
{"type": "ETF approval"}
{"type": "SEC regulatory decision"}  
{"type": "crypto regulation news"}
```

3 tên khác nhau → không merge được, không tạo binary vector được, không so sánh Jaccard được.

**Có taxonomy:** Ép LLM chọn từ danh sách cố định:
```json
{"event_group": "Regulation & Legal", "event_type": "Regulatory Announcement"}
```

Luôn nhất quán. Giống như dùng enum thay vì string tự do.

**Taxonomy = 13 nhóm × ~4-8 loại/nhóm = 56 loại tổng.**
Bài báo gốc xây cho cổ phiếu Trung Quốc (57 loại). Code adapt lại cho crypto (56 loại) — đổi "Corporate Equity" thành "Whale & On-chain", "Corporate Projects" thành "DeFi & Ecosystem", v.v.

**Cách bài báo tạo taxonomy:** Không ngồi nghĩ bằng tay. Cho LLM đọc toàn bộ tin tức training set, tự đề xuất loại sự kiện. Lặp đi lặp lại cho đến khi không còn loại mới. Sau đó con người review + sửa. Semi-automated.

---

## Step 2 — Merge: Tại sao 2 giai đoạn?

Giả sử 1 ngày có 50 sự kiện thô. Muốn biết cái nào trùng.

**Cách naive:** Gửi cả 50 sự kiện cho LLM, bảo "gộp cái nào giống nhau".
- Prompt rất dài → LLM mất tập trung (long-context degradation)
- Tốn token (tiền)
- 50 sự kiện so sánh chéo = O(n²) complexity trong đầu LLM

**Cách StockMem:**

```
50 sự kiện thô
    │
    │  Bước 1: Nhóm theo event_group (hard filter)
    v
[Regulation: 8] [Macro: 5] [Protocol: 12] ...
    │
    │  Bước 2: Cosine clustering trong mỗi nhóm (soft filter)
    │           threshold: cosine distance < 0.3
    v
[Reg: cụm1(3), cụm2(2), đơn(3)] [Macro: cụm1(2), đơn(3)] ...
    │
    │  Bước 3: Chỉ gọi LLM cho cụm > 1 sự kiện
    v
LLM merge cụm1(3 sự kiện) → 1 sự kiện gộp
LLM merge cụm2(2 sự kiện) → 1 sự kiện gộp
Các sự kiện đơn → giữ nguyên, không tốn LLM call
```

**Kết quả:** Thay vì 1 LLM call cho 50 sự kiện, chỉ cần ~5-8 LLM calls cho các cụm nhỏ (2-5 sự kiện/cụm). Mỗi call ngắn, LLM tập trung hơn, chính xác hơn, rẻ hơn.

**Tại sao nhóm theo event_group trước?** Vì "SEC phê duyệt ETF" (Regulation) không bao giờ trùng với "Fed tăng lãi suất" (Macroeconomic). Lọc cứng trước, giảm không gian tìm kiếm.

---

## Step 3 — Track: Phần phức tạp nhất, cũng quan trọng nhất

### Event Chain = Linked List xuyên thời gian

```
Ngày 1: "SEC nhận đơn ETF"           ← event #5  (prev: null)
Ngày 3: "SEC yêu cầu bổ sung hồ sơ" ← event #12 (prev: #5)
Ngày 5: "SEC hoãn quyết định"        ← event #18 (prev: #12)
Ngày 7: "SEC phê duyệt ETF"          ← event #25 (prev: #18)
```

Mỗi sự kiện có `prev_event_id` trỏ về sự kiện trước đó → linked list.
`chain_depth` = số bước đi ngược được (max 5 theo `D_MAX`).

### Cách tìm predecessor: cũng 2 giai đoạn

```
Sự kiện hôm nay (embedding)
    │
    │  Cosine similarity vs tất cả sự kiện trong 5 ngày trước
    v
Top-10 ứng viên (giống nhất về ngữ nghĩa)
    │
    │  LLM đọc nội dung cụ thể → xác nhận cái nào thực sự là "version cũ"
    v
predecessor_id + delta_info
```

### ΔInfo — deep dive

Đây **không phải** summary của sự kiện hôm nay. Đây là **phần khác biệt** so với version cũ.

**Analogy chính xác nhất: Pull Request description**

Bạn không viết PR description là "file X chứa function Y". Bạn viết "thêm retry logic vào function Y, trước đó không có retry nên hay bị timeout". Đó là ΔInfo — cái gì **thay đổi** và **tại sao nó quan trọng**.

**Ví dụ ΔInfo thực tế:**

| Sự kiện cũ | Sự kiện mới | ΔInfo |
|------------|------------|-------|
| SEC đang xem xét ETF | SEC phê duyệt ETF | Chuyển từ "xem xét" sang "phê duyệt", vượt kỳ vọng thị trường vốn đang đặt cược vào hoãn tiếp |
| CPI kỳ vọng 3.0% | CPI thực tế 2.5% | Thấp hơn kỳ vọng 0.5%, tín hiệu lạm phát hạ nhanh hơn dự kiến |
| Whale mua 3000 BTC | Cùng whale bán 5000 BTC | Đảo ngược hoàn toàn từ tích luỹ sang phân phối, tín hiệu bearish mạnh |
| Không có sự kiện trước | Binance bị hack $100M | ΔInfo = null (sự kiện hoàn toàn mới, không có predecessor) |

**Tại sao ΔInfo quan trọng hơn bản thân sự kiện?**

Kinh tế học gọi đây là **Efficient Market Hypothesis** (giả thuyết thị trường hiệu quả): giá đã phản ánh mọi thông tin đã biết. Chỉ thông tin **mới** (chưa được price-in) mới làm giá thay đổi.

Nếu chỉ cho LLM biết "SEC phê duyệt ETF = tin tốt", LLM luôn đoán "up". Nhưng thực tế:
- **Đã kỳ vọng từ trước** → giá không tăng (đã price-in)
- **Bất ngờ** → giá tăng mạnh
- **Sell the news** → giá giảm sau khi tin ra (mua tin đồn, bán sự thật)

ΔInfo giúp LLM hiểu **mức độ bất ngờ**, không chỉ **nội dung bề mặt**.

---

## Step 4 — Reflection: Supervised learning bằng ngôn ngữ tự nhiên

Thay vì train weight model (gradient descent), StockMem "train" bằng cách **viết bài phân tích**.

```
Input:  Chuỗi sự kiện tuần qua + "giá đã tăng 3%"
Output: "Giá tăng vì SEC phê duyệt ETF (ΔInfo: bất ngờ) + CPI tốt.
         Whale mua thêm = confirmation. BlackRock inflow kỷ lục = catalyst."
```

Đây là **hindsight analysis** (phân tích nhìn lại) — cho LLM biết đáp án trước, yêu cầu giải thích tại sao. Kết quả lưu thành "kinh nghiệm" trong bảng `reflections`.

**Tại sao không dùng fine-tuning?**
- Fine-tuning LLM tốn kém, chậm, khó update
- Reflection lưu trong DB, thêm/xoá/sửa bất cứ lúc nào
- Không cần retrain model — chỉ cần thêm dòng vào DB
- Explainable: đọc được lý do, không phải black box

**Online learning trong test phase:**
```
Dự đoán ngày 15/3 → up (đúng)
    → Viết reflection: "Tình huống X dẫn đến tăng giá vì Y"
    → Lưu vào DB
Dự đoán ngày 16/3 → có thêm 1 kinh nghiệm mới để tham chiếu
```

Bộ nhớ lớn dần mỗi ngày. Giống team dev ngày càng có nhiều post-mortem → xử lý incident nhanh hơn.

---

## Step 5 — Retrieval: Tại sao không dùng embedding similarity?

**Câu hỏi tự nhiên:** Đã có embedding từ Step 1-2, sao không dùng cosine similarity trên embedding để tìm chuỗi lịch sử giống nhất?

**Lý do:** Cần so sánh **chuỗi ngày** (sequence), không phải **1 sự kiện** (single document).

- Embedding similarity: tốt cho "sự kiện A giống sự kiện B không?"
- Jaccard trên binary vectors: tốt cho "bộ sự kiện ngày X giống bộ sự kiện ngày Y không?"
- SeqSim: tốt cho "chuỗi 5 ngày này giống chuỗi 5 ngày kia không?"

**Binary vector = feature fingerprint của 1 ngày:**

```
Ngày 2025-03-20:
  - Có sự kiện Regulatory Announcement     → type[0] = 1
  - Có sự kiện Interest Rate Decision      → type[5] = 1  
  - Có sự kiện Whale Accumulation          → type[30] = 1
  - 53 loại còn lại không xuất hiện        → type[...] = 0

type_vector = [1,0,0,0,0,1,0,...,1,...,0]   (56 chiều)
group_vector = [1,1,0,0,0,0,0,1,0,0,0,0,0] (13 chiều)
```

Không quan tâm **nội dung** cụ thể, chỉ quan tâm **loại gì xuất hiện**. Đây là thiết kế có chủ đích: khi so sánh pattern, chi tiết cụ thể ít quan trọng hơn **tổ hợp loại sự kiện**.

**DailySim = weighted Jaccard:**
```
DailySim = 0.7 × Jaccard(type_vec) + 0.3 × Jaccard(group_vec)
```

Tại sao 70/30? Type cụ thể hơn → phân biệt tốt hơn. Group quá rộng (chỉ 13 chiều) → dễ trùng ngẫu nhiên. Nhưng vẫn cần group vì đôi khi type quá sparse (ít sự kiện trong ngày → type vector gần như toàn 0).

**SeqSim = trung bình DailySim qua cả cửa sổ:**
```
SeqSim([ngày1..ngày5]_hiện_tại, [ngày1..ngày5]_lịch_sử) = 
    mean(DailySim(ngày5_ht, ngày5_ls), DailySim(ngày4_ht, ngày4_ls), ...)
```

So khớp **theo thứ tự thời gian**: ngày gần nhất so với ngày gần nhất, ngày xa nhất so với ngày xa nhất. Đảm bảo pattern match đúng diễn biến.

**Tại sao vẫn cần LLM lọc (giai đoạn 2)?**

Jaccard chỉ biết "2 ngày có cùng loại sự kiện". Nhưng:
- Ngày A có "SEC phê duyệt ETF" + ngày B cũng có "SEC enforcement action" → cùng type "Regulatory Announcement" nhưng **hoàn toàn khác ý nghĩa** (1 cái tích cực, 1 cái tiêu cực)
- LLM đọc nội dung sự kiện cụ thể + kết quả giá → phán đoán chuỗi nào **thực sự** tương tự

Giống search engine: giai đoạn 1 = inverted index (nhanh, recall cao), giai đoạn 2 = re-ranking model (chính xác, precision cao).

---

## Step 6 — Predict: Tổng hợp 3 nguồn

LLM nhận prompt có 3 phần:

```
┌─────────────────────────────────────────────────┐
│ ① Sự kiện 5 ngày gần đây                        │
│    (từ Event Memory — Step 1-2)                  │
│                                                  │
│ ② ΔInfo cho mỗi sự kiện                         │
│    (từ Event Tracking — Step 3)                  │
│                                                  │
│ ③ Kinh nghiệm lịch sử tương tự                  │
│    (từ Reflection Memory — Step 4-5)             │
│    VD: "Lần trước tình huống giống vầy,          │
│         giá tăng 5% vì lý do X"                  │
└─────────────────────────────────────────────────┘
                    │
                    v
              LLM dự đoán
              "up" + lý do
```

**Tại sao cần cả 3?**

| Chỉ có ① | Chỉ có ①② | Có ①②③ |
|-----------|-----------|--------|
| LLM biết có gì xảy ra | LLM biết có gì **mới** xảy ra | LLM biết có gì mới + **lần trước tình huống tương tự kết quả thế nào** |
| "SEC phê duyệt ETF = tốt → up" | "SEC phê duyệt, bất ngờ vì đang kỳ vọng hoãn → up mạnh" | "SEC phê duyệt bất ngờ, lần trước (01/2025) tình huống giống thế giá tăng 5% → up, mức ~3-5%" |
| Shallow (nông cạn) | Better (tốt hơn) | **Best — giống nhà phân tích có kinh nghiệm** |

---

## Data flow tổng thể

```
CryptoPanic + RSS ──────────────┐
                                v
Binance (giá OHLCV) ──> [label-generator]
                                │
                                v
                ┌───────────────────────────────┐
                │          SQLite DB             │
                │                               │
    Step 1 ───> │  raw_events (+ embedding)     │
                │       │                       │
    Step 2 ───> │  merged_events (gộp)          │
                │       │                       │
    Step 3 ───> │  merged_events (+ prev_id,    │
                │                  delta_info)   │
                │       │                       │
    Step 5 ───> │  daily_vectors (binary vecs)  │
                │                               │
    Step 4 ───> │  reflections (kinh nghiệm)    │
                │                               │
    Step 6 ───> │  predictions (up/down + lý do)│
                └───────────────────────────────┘
                                │
                                v
                        evaluate()
                    accuracy + MCC
```

---

## Cái gì giống paper, cái gì khác?

| Khía cạnh | Paper gốc | Code này |
|-----------|-----------|----------|
| Thị trường | Cổ phiếu Trung Quốc (A-share) | Crypto (BTC, ETH) |
| LLM | GPT (không nói rõ version) | Gemini 2.5 Flash |
| Embedding | Không nói rõ | BGE-M3 (GPU) / MiniLM (CPU) |
| Taxonomy | 13 nhóm / 57 loại (chứng khoán) | 13 nhóm / 56 loại (crypto) |
| Nguồn tin | Tin tức tài chính TQ | CryptoPanic + RSS (CoinDesk, CoinTelegraph, The Block) |
| Giá | Giá cổ phiếu | Binance OHLCV qua ccxt |
| Storage | Không đề cập | SQLite |
| Ngưỡng up/down | Không nói rõ | ±1% (`PRICE_THRESHOLD`) |
| Hyperparameters | w=5, α=0.7, D_max=5 | **Giữ nguyên** |
| 6 bước pipeline | Đầy đủ | **Giữ nguyên, đúng thứ tự** |
| Công thức 1-11 | Đầy đủ | **Implement đúng** |
| Retrieval 2 giai đoạn | Jaccard + LLM | **Giữ nguyên** |
| Online learning | Có | **Có** (`source = "online"` trong backtest) |

**Tóm lại:** Giữ nguyên toàn bộ kiến trúc và thuật toán. Chỉ thay domain (stock → crypto), LLM (GPT → Gemini), và nguồn dữ liệu.

---

## Điểm mạnh & hạn chế

### Điểm mạnh

- **Explainable:** Mọi dự đoán truy vết được đến bài báo gốc
- **Modular:** 6 bước độc lập, thay thế từng phần dễ dàng (đổi LLM, đổi nguồn tin, đổi embedding)
- **Bộ nhớ mở rộng:** Càng chạy lâu càng nhiều kinh nghiệm → dự đoán (có thể) tốt hơn
- **Không cần fine-tune:** Dùng LLM off-the-shelf, tri thức nằm trong DB

### Hạn chế

- **Phụ thuộc chất lượng LLM:** Extract sai → mọi bước sau sai theo
- **Chi phí API:** Mỗi ngày gọi LLM nhiều lần (Step 1: nhiều batch, Step 2: nhiều cụm, Step 3: nhiều sự kiện, Step 4-6: mỗi bước 1 lần)
- **Latency:** Pipeline đầy đủ mất vài phút/ngày (rate limit Gemini: 15 req/phút)
- **Jaccard mất thông tin:** Binary vector chỉ biết "có/không", không biết "bao nhiêu" hay "mức độ"
- **Giả định:** Lịch sử lặp lại — tình huống tương tự trong quá khứ sẽ có kết quả tương tự. Không phải lúc nào cũng đúng (black swan events)
