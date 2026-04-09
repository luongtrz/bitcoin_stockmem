# Giải thích đơn giản — Market Similarity

## Hệ thống này làm gì?

Cho 1 ngày giao dịch Bitcoin, hệ thống tìm ra **những ngày trong lịch sử có tình hình thị trường giống nhất**.

Ví dụ đơn giản:
> Hôm nay BTC tăng 3%, có tin ETF dòng tiền vào mạnh, cá voi tích lũy nhiều → Hệ thống tìm ra: "Ngày 20/11/2023 cũng có tình hình giống vậy, cũng có ETF inflows + cá voi mua, BTC cũng tăng 2.8%"

---

## Đầu vào (Input) — Cần gì?

Mỗi ngày giao dịch cần 10 thông tin:

```
1. date               → Ngày: "2024-01-15"
2. asset              → Tài sản: "BTC"
3. msi                → Chỉ số sức mạnh thị trường: 62.5 (0-100)
4. rsi                → Chỉ số RSI: 58.3 (0-100)
5. sentiment_score_avg → Tâm lý thị trường: 0.72 (-1 đến 1)
6. text               → Mô tả: "Bitcoin tăng mạnh nhờ ETF..."
7. factors            → Các sự kiện xảy ra: ["Record ETF inflows", "Strong whale accumulation"]
8. fear_greed_index   → Chỉ số sợ hãi/tham lam: 71 (0-100)
9. price              → Giá BTC: 42850
10. price_change_pct  → % thay đổi giá: +3.25%
```

**Quan trọng nhất là `factors`** — danh sách các sự kiện thị trường trong ngày. Đây là thông tin chiếm **93.75%** trọng lượng khi so sánh.

---

## Xử lý (Flow) — Hoạt động như nào?

Hệ thống biến mỗi ngày thành **1 dãy 80 con số** (gọi là vector), rồi so sánh các dãy số này với nhau.

### Bước 1: Phân loại sự kiện

Mỗi sự kiện (factor) được phân loại vào **loại sự kiện** và **nhóm sự kiện**.

```
"Record ETF inflows"          →  Loại: "ETF Flow"           →  Nhóm: "Hiệu suất thị trường"
"Fed holds interest rate steady" →  Loại: "Interest Rate Decision" →  Nhóm: "Kinh tế vĩ mô"
"Strong whale accumulation"   →  Loại: "Whale Accumulation"  →  Nhóm: "Cá voi & On-chain"
```

Hệ thống có **62 loại sự kiện** thuộc **13 nhóm**, lấy từ paper StockMem (công thức 3-4, phụ lục A).

### Bước 2: Biến sự kiện thành số (0 hoặc 1)

Tạo 2 dãy số nhị phân:

**Dãy loại sự kiện (62 ô):** Mỗi ô tương ứng 1 loại. Có sự kiện đó → ghi 1, không có → ghi 0.

```
Ví dụ: Ngày có "ETF Flow" và "Interest Rate Decision"

  Ô 1   Ô 2   ...  Ô 14  ...  Ô 44  ...  Ô 62
 [ 0  ,  0  , ... ,  1  , ... ,  1  , ... ,  0  ]
                     ↑           ↑
            Interest Rate    ETF Flow
```

**Dãy nhóm sự kiện (13 ô):** Tương tự nhưng theo nhóm.

```
  Nhóm 1  Nhóm 2  ...  Nhóm 10  ...  Nhóm 13
 [  0   ,   1   , ... ,   1   , ... ,   0    ]
            ↑              ↑
     Kinh tế vĩ mô   Hiệu suất thị trường
```

**Tham chiếu:** StockMem (arXiv:2512.02720), Mục 3.3, Công thức (3) và (4).

### Bước 3: Chuẩn hóa chỉ số thị trường

Lấy 5 chỉ số số học: `msi, rsi, sentiment, fear_greed, price_change_pct`.

Vấn đề: các chỉ số có thang đo khác nhau (RSI: 0-100, sentiment: -1→1). Nên cần **chuẩn hóa** (z-score) để đưa về cùng thang.

```
z = (giá trị - trung bình) / độ lệch chuẩn
```

Sau đó **nhân với 0.5** (trọng số α từ paper History Rhymes) để giảm ảnh hưởng so với sự kiện.

**Tham chiếu:** History Rhymes (Khanna, 2024) — trọng số α = 0.5 cho chỉ số số học.

### Bước 4: Ghép lại thành 1 vector

Nối 3 phần lại:

```
Vector cuối cùng (80 số) = [ dãy loại sự kiện (62) | dãy nhóm (13) | chỉ số × 0.5 (5) ]
                             ╰────── StockMem ──────╯                ╰── History Rhymes ──╯
```

Rồi **chuẩn hóa độ dài = 1** (L2-normalize) — tưởng tượng như đặt tất cả các điểm lên mặt cầu đơn vị.

**Tham chiếu:** History Rhymes — phương pháp `[features; α × numerical] → L2-normalize`.

### Bước 5: So sánh

Nhân 2 vector với nhau (inner product). Kết quả là 1 số từ -1 đến 1:

```
Điểm tương đồng = vector_ngày_A · vector_ngày_B = Σ (A[i] × B[i])
```

- **1.0** = giống hệt nhau
- **0.7 - 0.9** = rất giống
- **0.4 - 0.7** = khá giống
- **< 0.3** = khác nhau

So sánh với tất cả ngày trong cơ sở dữ liệu, sắp xếp từ cao xuống thấp, lấy top 5.

**Tham chiếu:** History Rhymes — inner product trên vector đã L2-normalize = cosine similarity.

### Bước 6: Tìm kiếm theo chuỗi 5 ngày (tùy chọn)

Thay vì so 1 ngày, có thể so **chuỗi 5 ngày liên tiếp**:

```
Tuần này:          [Thứ 2, Thứ 3, Thứ 4, Thứ 5, Thứ 6]
                      ↕      ↕      ↕      ↕      ↕
Tuần lịch sử:     [Ngày 1, Ngày 2, Ngày 3, Ngày 4, Ngày 5]

Điểm chuỗi = trung bình 5 điểm so sánh từng cặp ngày
```

Quan trọng: chuỗi lịch sử phải nằm **trước** chuỗi hiện tại (tránh gian lận dữ liệu).

**Tham chiếu:** StockMem, Mục 3.3, Công thức (8) — SeqSim.

---

## Đầu ra (Output) — Nhận được gì?

### Tìm kiếm 1 ngày

Gửi dữ liệu 1 ngày → Nhận danh sách ngày giống nhất:

```json
[
  {
    "rank": 1,
    "score": 0.82,
    "record": {
      "date": "2023-11-20",
      "factors": ["Record ETF inflows", "Strong whale accumulation"],
      "price_change_pct": 2.80,
      "...": "toàn bộ dữ liệu ngày đó"
    }
  },
  {
    "rank": 2,
    "score": 0.72,
    "record": { "..." : "ngày giống thứ 2" }
  }
]
```

| Trường | Ý nghĩa |
|--------|---------|
| `rank` | Thứ hạng (1 = giống nhất) |
| `score` | Điểm tương đồng (0 đến 1, càng cao càng giống) |
| `record` | Toàn bộ dữ liệu của ngày lịch sử đó |

### Tìm kiếm chuỗi 5 ngày

Gửi mảng 5 ngày → Nhận danh sách chuỗi 5 ngày giống nhất:

```json
[
  {
    "rank": 1,
    "score": 0.68,
    "daily_scores": [0.59, 0.65, 0.71, 0.72, 0.74],
    "window": [
      { "date": "2023-06-15", "..." : "ngày 1" },
      { "date": "2023-06-16", "..." : "ngày 2" },
      { "date": "2023-06-17", "..." : "ngày 3" },
      { "date": "2023-06-18", "..." : "ngày 4" },
      { "date": "2023-06-19", "..." : "ngày 5" }
    ]
  }
]
```

| Trường | Ý nghĩa |
|--------|---------|
| `rank` | Thứ hạng |
| `score` | Điểm trung bình chuỗi (SeqSim) |
| `daily_scores` | Điểm từng cặp ngày (ngày 1↔ngày 1, ngày 2↔ngày 2, ...) |
| `window` | Dữ liệu 5 ngày lịch sử |

---

## Ứng dụng thực tế

### Dự đoán xu hướng

```
Hôm nay giống ngày 20/11/2023 (score 0.82)
  → Ngày 21/11/2023: BTC tăng thêm 2.5%

Hôm nay giống ngày 14/07/2023 (score 0.72)
  → Ngày 15/07/2023: BTC giảm nhẹ 0.8%

→ 2/5 ngày giống tiếp tục tăng, 3/5 đi ngang → Cẩn thận
```

### Nhận diện mẫu hình tuần

```
5 ngày gần nhất (downtrend) giống tuần 15-19/06/2023 (score 0.68)
  → Ngày 20/06/2023: BTC bật tăng 5.2%

→ Lịch sử cho thấy sau downtrend tương tự, có khả năng bounce
```

---

## Tham chiếu 2 paper

Hệ thống kết hợp thuật toán từ 2 bài nghiên cứu:

### Paper 1: StockMem (arXiv:2512.02720)

> "StockMem: Khung LLM tăng cường bộ nhớ cho dự đoán giá cổ phiếu"

Lấy từ paper này:
- **Bảng phân loại sự kiện**: 13 nhóm × 62 loại (Mục 3.3, Phụ lục A)
- **Vector nhị phân**: Biến sự kiện thành dãy 0/1 — Công thức (3) và (4)
- **Tìm kiếm chuỗi ngày**: SeqSim — trung bình điểm tương đồng qua W ngày — Công thức (8)
- **Loại trừ thời gian**: Chỉ so sánh với dữ liệu quá khứ — Mục 3.3

### Paper 2: History Rhymes (Khanna, 2024)

> "History Rhymes: Sử dụng tương đồng lịch sử cho dự đoán thị trường"

Lấy từ paper này:
- **Cách ghép vector**: Nối [sự kiện; chỉ số số học × α] — Phương pháp chính
- **Trọng số α = 0.5**: Cân bằng giữa sự kiện và chỉ số — Siêu tham số
- **L2-normalize + inner product**: Cách tính độ tương đồng — Phép đo khoảng cách
- **Chuẩn hóa z-score**: Đưa các chỉ số về cùng thang đo

### Cách kết hợp

```
╔════════════════════════════════════════════════════════════════╗
║                    Vector 80 chiều                             ║
╠════════════════════╦═══════════════╦══════════════════════════╣
║  Loại sự kiện (62) ║  Nhóm (13)   ║  Chỉ số × 0.5 (5)      ║
║    StockMem (3)    ║ StockMem (4) ║   History Rhymes         ║
╠════════════════════╩═══════════════╩══════════════════════════╣
║  → L2-normalize (History Rhymes)                              ║
║  → Inner product để tính điểm tương đồng (History Rhymes)    ║
║  → Tìm chuỗi SeqSim qua 5 ngày (StockMem công thức 8)      ║
╚════════════════════════════════════════════════════════════════╝
```

---

## Cách dùng

### Qua API (Postman / curl)

**Địa chỉ:** `POST /api/search?k=5`

**Tìm 1 ngày:** Gửi body là 1 JSON object
```json
{
  "date": "2024-01-15",
  "asset": "BTC",
  "msi": 62.5,
  "rsi": 58.3,
  "sentiment_score_avg": 0.72,
  "text": "Bitcoin tăng nhờ ETF",
  "factors": ["Record ETF inflows", "Strong whale accumulation"],
  "fear_greed_index": 71,
  "price": 42850,
  "price_change_pct": 3.25
}
```

**Tìm chuỗi 5 ngày:** Gửi body là 1 mảng JSON gồm 5 objects

Hệ thống **tự động nhận biết**: object → tìm 1 ngày, mảng → tìm chuỗi ngày.

### Qua dòng lệnh (CLI)

```bash
# Nhập dữ liệu
npx tsx src/cli.ts index --file data/btc_2020.json

# Tìm kiếm 1 ngày
npx tsx src/cli.ts search --json '{...}'

# Tìm kiếm chuỗi 5 ngày
npx tsx src/cli.ts search --json '[{...}, {...}, {...}, {...}, {...}]'

# Xem tất cả ngày đã nhập
npx tsx src/cli.ts list
```

---

## Cấu trúc thư mục

```
market-similarity/
├── api/search.ts              ← API cho Vercel (serverless)
├── data/                      ← Dữ liệu JSON
│   ├── btc_2020.json ... 2024 ← Dữ liệu từng năm
│   └── bundle.json            ← Dữ liệu đã gom + vector hóa sẵn
├── scripts/
│   ├── generate-data.ts       ← Tạo dữ liệu mẫu
│   ├── bundle-data.ts         ← Gom dữ liệu cho serverless
│   └── eval-accuracy.ts       ← Đánh giá độ chính xác
└── src/
    ├── types.ts               ← Định nghĩa kiểu dữ liệu
    ├── config.ts              ← Cấu hình (α=0.5, W=5, K=5)
    ├── taxonomy.ts            ← Bảng phân loại sự kiện (StockMem)
    ├── vectorize.ts           ← Chuyển dữ liệu thành vector (lõi thuật toán)
    ├── search.ts              ← Tìm kiếm tương đồng
    ├── store.ts               ← Điều phối
    ├── cli.ts                 ← Giao diện dòng lệnh
    └── storage/
        ├── database.ts        ← Lưu trữ SQLite (chạy local)
        └── memory.ts          ← Lưu trữ bộ nhớ (chạy serverless)
```
