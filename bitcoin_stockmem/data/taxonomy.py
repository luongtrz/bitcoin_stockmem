"""Crypto event taxonomy: 13 groups, 56 event types.

Adapted from the original StockMem paper's 13 groups / 57 types for the
Chinese stock market, redesigned for cryptocurrency (BTC / ETH).
"""

# Ordered dict: group_name -> list of event types
EVENT_TAXONOMY: dict[str, list[str]] = {
    "Regulation & Legal": [
        "Regulatory Announcement",
        "Enforcement Action",
        "Legislation Progress",
        "Government Stance",
        "International Sanctions or Bans",
    ],
    "Macroeconomic": [
        "Interest Rate Decision",
        "Inflation Data",
        "Dollar Index Movement",
        "Quantitative Easing or Tightening",
    ],
    "Industry Standards & Opinions": [
        "Protocol Proposal",
        "Industry Report",
        "Analyst or Influencer Opinion",
    ],
    "Protocol & Product": [
        "Protocol Upgrade",
        "New Feature Launch",
        "Testnet or Mainnet Launch",
        "Adoption Metric Change",
        "Fee or Gas Change",
        "Hash Rate Change",
        "Supply Dynamics",
    ],
    "Technology & Development": [
        "Technical Breakthrough",
        "Development Milestone",
        "Audit or Certification",
        "Node or Validator Update",
        "Ecosystem Integration",
        "Developer Tooling",
    ],
    "Exchange & Trading": [
        "Listing or Delisting",
        "Funding Round",
        "Revenue Report",
        "Acquisition",
        "Partnership Deal",
        "Custody Agreement",
        "Liquidation Event",
        "Reserve Proof",
    ],
    "DeFi & Ecosystem": [
        "Protocol Launch",
        "Protocol Migration",
        "Cross-chain Expansion",
    ],
    "Whale & On-chain": [
        "Whale Accumulation",
        "Whale Distribution",
        "On-chain Flow Anomaly",
        "Miner Selling",
    ],
    "Key Figures": [
        "Executive Appointment",
        "Founder Statement",
        "Legal Action Against Individual",
    ],
    "Market Performance": [
        "Market Cap Milestone",
        "Sector Rotation",
        "BTC Dominance Shift",
        "Volume Surge",
        "ETF Flow",
        "Institutional View",
    ],
    "TradFi Crossover": [
        "Stock Correlation",
        "Bond Signal",
        "Commodity Correlation",
        "Stablecoin Flow",
    ],
    "Partnership & Adoption": [
        "Strategic Partnership",
        "Payment Integration",
        "Institutional Adoption",
        "Alliance Formation",
    ],
    "Risk & Warning": [
        "Security Breach or Hack",
        "Rug Pull or Scam",
        "Regulatory Risk",
        "Systemic Risk",
        "Exchange Insolvency",
    ],
}

# ---------------------------------------------------------------------------
# Derived look-ups
# ---------------------------------------------------------------------------

# Flat list of all groups (length G = 13)
ALL_GROUPS: list[str] = list(EVENT_TAXONOMY.keys())

# Flat list of all types (length M = 56)
ALL_TYPES: list[str] = [
    t for types in EVENT_TAXONOMY.values() for t in types
]

# Index mappings for binary vector construction
GROUP_TO_INDEX: dict[str, int] = {g: i for i, g in enumerate(ALL_GROUPS)}
TYPE_TO_INDEX: dict[str, int] = {t: i for i, t in enumerate(ALL_TYPES)}

NUM_GROUPS: int = len(ALL_GROUPS)  # G = 13
NUM_TYPES: int = len(ALL_TYPES)    # M = 56


def get_group_index(name: str) -> int | None:
    return GROUP_TO_INDEX.get(name)


def get_type_index(name: str) -> int | None:
    return TYPE_TO_INDEX.get(name)


def format_taxonomy_for_prompt() -> tuple[str, str]:
    """Return (groups_str, type_list_str) for use in LLM prompts."""
    groups_str = ", ".join(ALL_GROUPS)
    lines = []
    for group, types in EVENT_TAXONOMY.items():
        lines.append(f"  {group}: {', '.join(types)}")
    type_list_str = "\n".join(lines)
    return groups_str, type_list_str
