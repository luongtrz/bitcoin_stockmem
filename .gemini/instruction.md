# Phân tích task: JSON Vector Retrieval System

## Ngày: 2026-04-05

## Lần 1 - Phân tích ban đầu (đã bỏ)
- Đề xuất sai: dùng pipeline 6 bước StockMem -> quá phức tạp
- User muốn đơn giản hơn: chỉ cần vector search

## Lần 2 - Hiểu đúng yêu cầu

### Mục tiêu
Tạo hệ thống tìm kiếm tương tự (similarity search) cho dữ liệu BTC hàng ngày:
- **DB**: 365 ngày JSON, mỗi ngày có index + vector (vectorize từ JSON)
- **Input**: 1 JSON object đầu vào
- **Xử lý**: Vectorize input -> tìm Top 5 vector gần nhất (cosine similarity)
- **Output**: Trả về 5 JSON gốc ban đầu tương ứng với 5 vector gần nhất

### JSON Schema
```json
{
  "date": "2026-04-01",
  "asset": "BTC",
  "msi": 72.5,
  "rsi": 65.3,
  "sentiment_score_avg": 0.72,
  "text": "Tóm tắt bài báo...",
  "factors": ["SEC quy định mới", "Whale tích lũy"],
  "fear_greed_index": 68,
  "price": 84500.00,
  "price_change_pct": 2.5
}
```

### Kiến trúc (ĐÃ TRIỂN KHAI)
```
history-retrieval/           <-- folder riêng tại root, không đụng code cũ
  package.json
  tsconfig.json
  src/
    types.ts                 - Interface DailyJsonInput, StoredRecord, SearchResult
    vectorize.ts             - Chuyển JSON -> vector 62 chiều (6 numeric + 56 factor one-hot)
    mock-data-generator.ts   - Tạo 365 ngày mock data BTC (random walk + trend)
    search.ts                - Cosine similarity search, trả Top K
    database.ts              - SQLite CRUD (bảng daily_records: id, date, asset, json_data, vector)
    index.ts                 - Entry point CLI (--demo, --generate-mock, --search)
  data/
    json-stockmem.db         - SQLite DB (tự tạo khi chạy)
```

### Cách chạy
```bash
cd history-retrieval
npm install
npx tsx src/index.ts --demo              # Tạo mock + chạy demo search
npx tsx src/index.ts --generate-mock     # Chỉ tạo 365 ngày mock
npx tsx src/index.ts --search '{"date":"2026-04-05","asset":"BTC","msi":72.5,...}'  # Tìm kiếm
```

### Kết quả
- Demo chạy thành công
- Tạo 365 bản ghi mock, tìm Top 5 tương tự với cosine similarity score 0.81-0.91
- Output là JSON array chứa 5 bản ghi gốc + score

### Vectorize strategy
- 6 chiều số (MSI, RSI, sentiment, fear_greed, price_change sigmoid, log_price)
- 56 chiều one-hot (factor keywords mapping vào taxonomy crypto)
- Tổng: 62 chiều

### Lưu ý
- Không dùng icon/emoji trong code
- Luôn dùng tiếng Việt có dấu
- Folder riêng `history-retrieval/` tại root, không sửa code cũ trong `bitcoin-stockmem-ts/`
