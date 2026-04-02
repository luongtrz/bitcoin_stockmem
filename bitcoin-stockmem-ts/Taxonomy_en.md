# Taxonomy - Event Classification System

## What is Taxonomy and why is it needed?

Taxonomy is a **hierarchical event classification system**. It acts as a "dictionary" so the LLM knows how to label events consistently, rather than inventing arbitrary categories.

**Why is it needed?**
- Without taxonomy, LLM might call the same event "Bitcoin ETF approved", "ETF news", "SEC ETF ruling" — inconsistent naming
- Cannot create binary vectors for Jaccard similarity (Step 5) — unknown number of dimensions
- Cannot group events for merging (Step 2)

---

## 2-level structure: Group -> Types

```
Group (level 1, coarse)       ->    Event Types (level 2, fine-grained)
  "Regulation & Legal"        ->    "Regulatory Announcement", "Enforcement Action", ...
  "Macroeconomic"             ->    "Interest Rate Decision", "Inflation Data", ...
```

- **Group**: broad categorization, 13 groups total
- **Type**: specific classification within each group, 56 types total

---

## How the paper builds the taxonomy (Appendix A)

The paper uses **"LLM-driven Iterative Induction and Human Correction"**:

1. Start with an empty taxonomy
2. Each iteration: LLM reads all news in the training set, performs 2 tasks:
   - Can be classified into existing type -> keep as is
   - Cannot be classified -> propose new type
3. Repeat until LLM proposes no new types across multiple consecutive iterations
4. Humans review + manually correct the final result

The original paper (for **Chinese stocks**) has 13 groups / 57 types:

| Paper Group | Paper Types |
|-------------|-------------|
| Policies and Regulation | Policy Release, Development Planning, Government Support, Institutional Supervision, International Controls and Sanctions |
| Macroeconomic Finance | Fiscal Policy, Livelihood and Welfare, Taxation |
| Industry Standards | Standards, Specifications, Opinions and Commentary |
| Products and Market | R&D, New Product Launch, Product Mass Production, Product Application, Price Changes, Output Changes, Supply-Demand Dynamics |
| Technology Events | Technological Breakthrough, R&D Progress, Certification, Shipment, Ecosystem Collaboration, Enablement |
| Corporate Operations | Investment, Financing, Expenditure, Profitability, Order/Service Agreement Signing, Agreement Changes, Contracts, M&A |
| Corporate Projects | Project Initiation, Project Implementation, Cross-sector Expansion |
| Corporate Equity | Shareholder Changes, Share Increase, Share Decrease, Ownership Disputes |
| Corporate Personnel | Executives, Personnel Changes, Violations and Misconduct |
| Stock Market Performance | Market Size, Sector Concept Performance, Individual Stock Performance, Capital Flows, Trading Activities, Institutional Views |
| Other Financial Market | Market Size, Market Performance, Capital Flows, Institutional Views |
| Cooperation and Strategy | Strategic Cooperation, Industry Alliances and Standards Organizations |
| Risks and Warnings | Business Clarification, Company-Specific Risks, Industry-Wide Risk Alerts |

---

## How the code adapts taxonomy for crypto

The code keeps the 13-group structure but **renames and adjusts content for the crypto market**:

| Paper (Chinese Stock) | Code (Crypto) | Reason for change |
|------------------------|---------------|-------------------|
| Policies and Regulation | **Regulation & Legal** | Crypto has many legal issues (SEC, bans) |
| Macroeconomic Finance | **Macroeconomic** | Kept similar — interest rates, inflation affect crypto |
| Industry Standards | **Industry Standards & Opinions** | Added "Opinions" since KOLs/influencers are very important in crypto |
| Products and Market | **Protocol & Product** | Stocks have "products", crypto has "protocols" |
| Technology Events | **Technology & Development** | Added audit, node/validator — blockchain-specific |
| Corporate Operations | **Exchange & Trading** | No "corporate" in crypto, replaced with exchange/trading platform concepts |
| Corporate Projects | **DeFi & Ecosystem** | Replaced with DeFi — crypto-specific ecosystem |
| Corporate Equity | **Whale & On-chain** | No shareholders, replaced with whales and on-chain data |
| Corporate Personnel | **Key Figures** | Founders/CEOs in crypto (e.g., Elon Musk, CZ) |
| Stock Market Performance | **Market Performance** | Adapted for crypto: BTC dominance, ETF flow, market cap |
| Other Financial Market | **TradFi Crossover** | Relationship between crypto and traditional finance |
| Cooperation and Strategy | **Partnership & Adoption** | Crypto cares more about "adoption" (mass usage) |
| Risks and Warnings | **Risk & Warning** | Added hack, rug pull, exchange insolvency — crypto-specific risks |

---

## Full crypto taxonomy (`src/data/taxonomy.ts`)

| # | Group | Event Types |
|---|-------|-------------|
| 1 | **Regulation & Legal** | Regulatory Announcement, Enforcement Action, Legislation Progress, Government Stance, International Sanctions or Bans |
| 2 | **Macroeconomic** | Interest Rate Decision, Inflation Data, Dollar Index Movement, Quantitative Easing or Tightening |
| 3 | **Industry Standards & Opinions** | Protocol Proposal, Industry Report, Analyst or Influencer Opinion |
| 4 | **Protocol & Product** | Protocol Upgrade, New Feature Launch, Testnet or Mainnet Launch, Adoption Metric Change, Fee or Gas Change, Hash Rate Change, Supply Dynamics |
| 5 | **Technology & Development** | Technical Breakthrough, Development Milestone, Audit or Certification, Node or Validator Update, Ecosystem Integration, Developer Tooling |
| 6 | **Exchange & Trading** | Listing or Delisting, Funding Round, Revenue Report, Acquisition, Partnership Deal, Custody Agreement, Liquidation Event, Reserve Proof |
| 7 | **DeFi & Ecosystem** | Protocol Launch, Protocol Migration, Cross-chain Expansion |
| 8 | **Whale & On-chain** | Whale Accumulation, Whale Distribution, On-chain Flow Anomaly, Miner Selling |
| 9 | **Key Figures** | Executive Appointment, Founder Statement, Legal Action Against Individual |
| 10 | **Market Performance** | Market Cap Milestone, Sector Rotation, BTC Dominance Shift, Volume Surge, ETF Flow, Institutional View |
| 11 | **TradFi Crossover** | Stock Correlation, Bond Signal, Commodity Correlation, Stablecoin Flow |
| 12 | **Partnership & Adoption** | Strategic Partnership, Payment Integration, Institutional Adoption, Alliance Formation |
| 13 | **Risk & Warning** | Security Breach or Hack, Rug Pull or Scam, Regulatory Risk, Systemic Risk, Exchange Insolvency |

---

## Where taxonomy is used in the pipeline

### 1. Step 1 — Extraction (LLM prompt)

```ts
formatTaxonomyForPrompt() // returns:
//   groups: "Regulation & Legal, Macroeconomic, ..."
//   typeList:
//     Regulation & Legal: Regulatory Announcement, Enforcement Action, ...
//     Macroeconomic: Interest Rate Decision, Inflation Data, ...
//     ...
```

The LLM reads this taxonomy and classifies each event into the correct group + type.

### 2. Step 2 — Merging

Raw events are **grouped by `event_group`** before clustering + merging. Only events within the same group are merged.

### 3. Step 5 — Retrieval (binary vectors for Jaccard)

```ts
// Type vector: 56 dimensions, each dimension = 1 type
V_t = [0, 1, 0, 0, 1, ...]  // 1 = this type appeared on day t

// Group vector: 13 dimensions, each dimension = 1 group
G_t = [1, 0, 1, 0, ...]     // 1 = this group has events on day t
```

Example: on 2025-03-15 there are events:
- "Regulatory Announcement" (group: Regulation & Legal)
- "Interest Rate Decision" (group: Macroeconomic)
- "Whale Accumulation" (group: Whale & On-chain)

-> `type_vector[0] = 1, type_vector[4] = 1, type_vector[30] = 1, ...` (corresponding types)
-> `group_vector[0] = 1, group_vector[1] = 1, group_vector[7] = 1` (3 groups)

Then compute:
```
DailySim = 0.7 * Jaccard(type_vec_A, type_vec_B) + 0.3 * Jaccard(group_vec_A, group_vec_B)
```

**Why use both levels?** Group gives "big picture" similarity (same broad theme), while type gives "fine-grained" matching (same specific event kind). Alpha = 0.7 means **type is more important than group** (70% vs 30%).
