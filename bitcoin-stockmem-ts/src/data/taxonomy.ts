/**
 * Crypto event taxonomy: 13 groups, 56 event types.
 */

export const EVENT_TAXONOMY: Record<string, string[]> = {
  "Regulation & Legal": [
    "Regulatory Announcement", "Enforcement Action", "Legislation Progress",
    "Government Stance", "International Sanctions or Bans",
  ],
  "Macroeconomic": [
    "Interest Rate Decision", "Inflation Data",
    "Dollar Index Movement", "Quantitative Easing or Tightening",
  ],
  "Industry Standards & Opinions": [
    "Protocol Proposal", "Industry Report", "Analyst or Influencer Opinion",
  ],
  "Protocol & Product": [
    "Protocol Upgrade", "New Feature Launch", "Testnet or Mainnet Launch",
    "Adoption Metric Change", "Fee or Gas Change", "Hash Rate Change",
    "Supply Dynamics",
  ],
  "Technology & Development": [
    "Technical Breakthrough", "Development Milestone", "Audit or Certification",
    "Node or Validator Update", "Ecosystem Integration", "Developer Tooling",
  ],
  "Exchange & Trading": [
    "Listing or Delisting", "Funding Round", "Revenue Report", "Acquisition",
    "Partnership Deal", "Custody Agreement", "Liquidation Event", "Reserve Proof",
  ],
  "DeFi & Ecosystem": [
    "Protocol Launch", "Protocol Migration", "Cross-chain Expansion",
  ],
  "Whale & On-chain": [
    "Whale Accumulation", "Whale Distribution",
    "On-chain Flow Anomaly", "Miner Selling",
  ],
  "Key Figures": [
    "Executive Appointment", "Founder Statement",
    "Legal Action Against Individual",
  ],
  "Market Performance": [
    "Market Cap Milestone", "Sector Rotation", "BTC Dominance Shift",
    "Volume Surge", "ETF Flow", "Institutional View",
  ],
  "TradFi Crossover": [
    "Stock Correlation", "Bond Signal",
    "Commodity Correlation", "Stablecoin Flow",
  ],
  "Partnership & Adoption": [
    "Strategic Partnership", "Payment Integration",
    "Institutional Adoption", "Alliance Formation",
  ],
  "Risk & Warning": [
    "Security Breach or Hack", "Rug Pull or Scam", "Regulatory Risk",
    "Systemic Risk", "Exchange Insolvency",
  ],
};

export const ALL_GROUPS = Object.keys(EVENT_TAXONOMY);
export const ALL_TYPES = Object.values(EVENT_TAXONOMY).flat();

export const GROUP_TO_INDEX = new Map(ALL_GROUPS.map((g, i) => [g, i]));
export const TYPE_TO_INDEX = new Map(ALL_TYPES.map((t, i) => [t, i]));

export const NUM_GROUPS = ALL_GROUPS.length; // 13
export const NUM_TYPES = ALL_TYPES.length;   // 56

export function formatTaxonomyForPrompt(): { groups: string; typeList: string } {
  const groups = ALL_GROUPS.join(", ");
  const lines = Object.entries(EVENT_TAXONOMY).map(
    ([group, types]) => `  ${group}: ${types.join(", ")}`
  );
  return { groups, typeList: lines.join("\n") };
}
