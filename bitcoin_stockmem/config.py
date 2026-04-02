"""Central configuration for Bitcoin StockMem framework."""

import os

# ---------------------------------------------------------------------------
# Environment detection
# ---------------------------------------------------------------------------
try:
    _ip = get_ipython()  # type: ignore[name-defined]
    IN_COLAB = "google.colab" in str(type(_ip))
except NameError:
    IN_COLAB = False

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
if IN_COLAB:
    DRIVE_ROOT = "/content/drive/MyDrive/bitcoin_stockmem"
    DB_PATH = os.path.join(DRIVE_ROOT, "stockmem.db")
    CACHE_DIR = os.path.join(DRIVE_ROOT, "cache")
else:
    PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
    DB_PATH = os.path.join(PROJECT_ROOT, "data", "stockmem.db")
    CACHE_DIR = os.path.join(PROJECT_ROOT, "cache")

# ---------------------------------------------------------------------------
# API Keys (set via environment variables or Colab Secrets)
# ---------------------------------------------------------------------------
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
CRYPTOPANIC_API_KEY = os.environ.get("CRYPTOPANIC_API_KEY", "")

# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------
ASSETS = ["BTC", "ETH"]
TRADING_PAIRS = {"BTC": "BTC/USDT", "ETH": "ETH/USDT"}

# ---------------------------------------------------------------------------
# Hyperparameters (from paper)
# ---------------------------------------------------------------------------
WINDOW_SIZE = 5          # w: number of days in event sequence window
ALPHA = 0.7              # weight for type-level vs group-level similarity
D_MAX = 5                # maximum event chain trace depth
TOP_K_TRACK = 10         # Top-K candidates for event tracking
TOP_K_RETRIEVE = 10      # Top-K candidates for sequence retrieval
PRICE_THRESHOLD = 0.02   # ±2% for up/down classification (adapted for crypto)

# ---------------------------------------------------------------------------
# Clustering (event merging)
# ---------------------------------------------------------------------------
CLUSTER_DISTANCE_THRESHOLD = 0.3  # cosine distance for agglomerative clustering

# ---------------------------------------------------------------------------
# Gemini API
# ---------------------------------------------------------------------------
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_RPM = 15              # requests per minute (free tier)
GEMINI_RETRY_DELAY = 4.0     # seconds between retries
GEMINI_MAX_RETRIES = 3
GEMINI_TEMPERATURE = 0.0     # deterministic output

# ---------------------------------------------------------------------------
# Embedding model
# ---------------------------------------------------------------------------
EMBEDDING_MODEL = "BAAI/bge-m3"
EMBEDDING_FALLBACK = "sentence-transformers/all-MiniLM-L6-v2"  # CPU fallback
