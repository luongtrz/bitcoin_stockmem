# Bitcoin StockMem

Reimplementation of the [StockMem paper](https://arxiv.org/abs/2512.02720) (Event-Reflection Memory Framework) for **BTC + ETH** price prediction using **Gemini 2.5 Flash** and **BGE-M3** embeddings.

## Prerequisites

- Node.js >= 18
- Python >= 3.10
- Gemini API key ([get one here](https://aistudio.google.com/apikey))
- CryptoPanic API key (optional, [free tier](https://cryptopanic.com/developers/api/))

## Setup

### 1. Install Node.js dependencies

```bash
cd bitcoin-stockmem-ts
npm install
```

### 2. Create Python virtual environment for embeddings

```bash
python3 -m venv .venv
source .venv/bin/activate        # Linux/macOS
# .venv\Scripts\activate         # Windows

pip install numpy sentence-transformers torch
```

> BGE-M3 requires ~1.7GB GPU memory. If you don't have a GPU, the system falls back to `all-MiniLM-L6-v2` (CPU).

### 3. Configure API keys

Copy the example and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```
GEMINI_API_KEY=your_gemini_api_key_here
CRYPTOPANIC_API_KEY=your_cryptopanic_api_key_here
```

**Cách lấy CRYPTOPANIC_API_KEY:**

1. Đăng ký tài khoản tại https://cryptopanic.com (miễn phí)
2. Vào https://cryptopanic.com/developers/api/
3. Copy API key hiển thị ở mục `auth_token`
4. Paste vào `.env`

> Free tier (Developer) cho phép truy cập endpoint `/api/developer/v2/posts/` với filter theo currency, kind, region. Rate limit ~2 req/s.

### 4. Run the pipeline

Make sure the Python venv is activated, then:

```bash
npm start
```

Or with custom date ranges:

```bash
npx tsx src/index.ts \
  --train-start 2025-01-01 --train-end 2025-03-31 \
  --test-start 2025-04-01 --test-end 2025-06-30
```

## How It Works

The pipeline follows the StockMem paper's 6-step process:

1. **Extract** — LLM extracts structured events from crypto news
2. **Merge** — Duplicate events within each day are clustered and merged
3. **Track** — Event chains are built across days, extracting incremental information (ΔInfo)
4. **Reflect** — Causal relationships between events and price movements are analysed (training)
5. **Retrieve** — Historically similar event sequences are found via Jaccard similarity + LLM filtering
6. **Predict** — LLM synthesises current events + ΔInfo + historical experience → up/down prediction

After each test prediction, the true label is fed back into the memory (online learning).

## Project Structure

```
src/
├── config.ts                   # Hyperparameters & API keys
├── index.ts                    # Main entry point
├── data/                       # Price (Binance), news (CryptoPanic + RSS), taxonomy, labels
├── embeddings/                 # BGE-M3 via Python subprocess + cosine similarity
├── llm/                        # Gemini 2.5 Flash client, prompts, response parsing
├── pipeline/                   # Steps 1-6 (extract, merge, track, reason, retrieve, predict)
├── memory/                     # Event memory, reflection memory, Jaccard similarity
├── storage/                    # SQLite (better-sqlite3)
└── evaluation/                 # ACC, MCC metrics + rolling-window backtest
```

## Key Hyperparameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `WINDOW_SIZE` | 5 | Days in event sequence window |
| `ALPHA` | 0.7 | Type vs group weight in similarity |
| `D_MAX` | 5 | Max event chain depth |
| `TOP_K_RETRIEVE` | 10 | Candidates for sequence retrieval |
| `PRICE_THRESHOLD` | ±2% | Up/down classification threshold |

## Notes

- Gemini free tier: 15 requests/min. Processing ~180 days takes 6-12 hours.
- Data is stored in `data/stockmem.db` (SQLite). Delete it to start fresh.
- The Python embedding server starts automatically and stays alive during the pipeline run.
