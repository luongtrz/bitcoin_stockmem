# Taxonomy - Hệ thống phân loại sự kiện

## Taxonomy (phân loại học) là gì và tại sao cần nó?

Taxonomy là **hệ thống phân loại sự kiện theo cấp bậc** (hierarchical - phân cấp). Nó giống như "từ điển" để LLM biết phải gán nhãn (label) sự kiện như thế nào, thay vì để LLM tự nghĩ ra các loại bất kỳ.

**Tại sao cần?**
- Nếu không có taxonomy, LLM có thể gọi cùng 1 sự kiện là "Bitcoin ETF approved", "ETF news", "SEC ETF ruling" — không nhất quán
- Không thể tạo binary vectors (véc-tơ nhị phân) cho Jaccard similarity (độ tương đồng Jaccard) ở Step 5 — vì không biết có bao nhiêu chiều
- Không thể nhóm (group) sự kiện để merge (gộp) ở Step 2

---

## Cấu trúc 2 cấp: Group (nhóm) -> Types (loại)

```
Group (cấp 1, thô)           ->    Event Types (cấp 2, chi tiết)
  "Regulation & Legal"       ->    "Regulatory Announcement", "Enforcement Action", ...
  "Macroeconomic"            ->    "Interest Rate Decision", "Inflation Data", ...
```

- **Group** (nhóm): phân loại rộng, 13 nhóm
- **Type** (loại): phân loại cụ thể trong mỗi group, tổng 56 loại

---

## Bài báo xây dựng taxonomy như thế nào? (Appendix A - Phụ lục A)

Bài báo dùng phương pháp **"LLM-driven Iterative Induction and Human Correction"** (quy nạp lặp bằng LLM kết hợp hiệu chỉnh thủ công):

1. Bắt đầu với taxonomy rỗng
2. Mỗi vòng lặp: LLM đọc tất cả tin tức trong training set (tập huấn luyện), làm 2 việc:
   - Phân loại được vào type cũ -> giữ nguyên
   - Không phân loại được -> đề xuất type mới
3. Lặp lại cho đến khi LLM không đề xuất thêm type mới nào nữa qua nhiều vòng liên tiếp
4. Con người review (rà soát) + sửa tay kết quả cuối

Bài báo gốc (cho **cổ phiếu Trung Quốc**) có 13 groups / 57 types:

| Nhóm trong bài báo | Các loại sự kiện |
|---------------------|------------------|
| Policies and Regulation (Chính sách & Quy định) | Policy Release (ban hành chính sách), Development Planning (quy hoạch phát triển), Government Support (hỗ trợ chính phủ), Institutional Supervision (giám sát tổ chức), International Controls and Sanctions (kiểm soát & cấm vận quốc tế) |
| Macroeconomic Finance (Tài chính vĩ mô) | Fiscal Policy (chính sách tài khóa), Livelihood and Welfare (dân sinh & phúc lợi), Taxation (thuế) |
| Industry Standards (Tiêu chuẩn ngành) | Standards (tiêu chuẩn), Specifications (quy cách), Opinions and Commentary (ý kiến & bình luận) |
| Products and Market (Sản phẩm & Thị trường) | R&D (nghiên cứu phát triển), New Product Launch (ra mắt sản phẩm mới), Product Mass Production (sản xuất hàng loạt), Product Application (ứng dụng sản phẩm), Price Changes (thay đổi giá), Output Changes (thay đổi sản lượng), Supply-Demand Dynamics (động lực cung cầu) |
| Technology Events (Sự kiện công nghệ) | Technological Breakthrough (đột phá công nghệ), R&D Progress (tiến độ R&D), Certification (chứng nhận), Shipment (xuất hàng), Ecosystem Collaboration (hợp tác hệ sinh thái), Enablement (tích hợp kỹ thuật) |
| Corporate Operations (Hoạt động doanh nghiệp) | Investment (đầu tư), Financing (huy động vốn), Expenditure (chi tiêu), Profitability (lợi nhuận), Order/Service Agreement Signing (ký hợp đồng), Agreement Changes (thay đổi hợp đồng), Contracts (hợp đồng), M&A (mua bán & sáp nhập) |
| Corporate Projects (Dự án doanh nghiệp) | Project Initiation (khởi động dự án), Project Implementation (triển khai dự án), Cross-sector Expansion (mở rộng liên ngành) |
| Corporate Equity (Vốn cổ phần) | Shareholder Changes (thay đổi cổ đông), Share Increase (tăng cổ phần), Share Decrease (giảm cổ phần), Ownership Disputes (tranh chấp sở hữu) |
| Corporate Personnel (Nhân sự doanh nghiệp) | Executives (lãnh đạo), Personnel Changes (thay đổi nhân sự), Violations and Misconduct (vi phạm & sai phạm) |
| Stock Market Performance (Diễn biến thị trường chứng khoán) | Market Size (quy mô thị trường), Sector Concept Performance (diễn biến ngành), Individual Stock Performance (diễn biến cổ phiếu đơn lẻ), Capital Flows (dòng vốn), Trading Activities (hoạt động giao dịch), Institutional Views (quan điểm tổ chức) |
| Other Financial Market (Thị trường tài chính khác) | Market Size (quy mô), Market Performance (diễn biến), Capital Flows (dòng vốn), Institutional Views (quan điểm tổ chức) |
| Cooperation and Strategy (Hợp tác & Chiến lược) | Strategic Cooperation (hợp tác chiến lược), Industry Alliances and Standards Organizations (liên minh ngành & tổ chức tiêu chuẩn) |
| Risks and Warnings (Rủi ro & Cảnh báo) | Business Clarification (đính chính kinh doanh), Company-Specific Risks (rủi ro riêng công ty), Industry-Wide Risk Alerts (cảnh báo rủi ro toàn ngành) |

---

## Code chuyển đổi taxonomy cho crypto như thế nào?

Code giữ nguyên cấu trúc 13 groups nhưng **đổi tên và nội dung cho phù hợp với thị trường crypto**:

| Bài báo (Cổ phiếu TQ) | Code (Crypto) | Lý do đổi |
|-------------------------|---------------|-----------|
| Policies and Regulation | **Regulation & Legal** (Quy định & Pháp lý) | Crypto có nhiều vấn đề pháp lý (SEC, lệnh cấm) |
| Macroeconomic Finance | **Macroeconomic** (Kinh tế vĩ mô) | Giữ nguyên — lãi suất, lạm phát ảnh hưởng crypto |
| Industry Standards | **Industry Standards & Opinions** (Tiêu chuẩn ngành & Ý kiến) | Thêm "Opinions" vì KOL/influencer (người ảnh hưởng) rất quan trọng trong crypto |
| Products and Market | **Protocol & Product** (Giao thức & Sản phẩm) | Cổ phiếu có "sản phẩm", crypto có "protocol" (giao thức) |
| Technology Events | **Technology & Development** (Công nghệ & Phát triển) | Thêm audit (kiểm toán), node/validator (nút xác thực) — đặc thù blockchain |
| Corporate Operations | **Exchange & Trading** (Sàn giao dịch & Giao dịch) | Không có "doanh nghiệp" truyền thống trong crypto, thay bằng sàn giao dịch |
| Corporate Projects | **DeFi & Ecosystem** (Tài chính phi tập trung & Hệ sinh thái) | Thay bằng DeFi — hệ sinh thái đặc thù crypto |
| Corporate Equity | **Whale & On-chain** (Cá voi & Dữ liệu trên chuỗi) | Không có cổ đông, thay bằng whale (cá voi - người nắm giữ lượng lớn) và dữ liệu on-chain |
| Corporate Personnel | **Key Figures** (Nhân vật chủ chốt) | Founder/CEO trong crypto (VD: Elon Musk, CZ) |
| Stock Market Performance | **Market Performance** (Diễn biến thị trường) | Đổi cho crypto: BTC dominance (tỷ trọng BTC), ETF flow (dòng vốn ETF), market cap (vốn hóa) |
| Other Financial Market | **TradFi Crossover** (Giao thoa tài chính truyền thống) | Mối quan hệ giữa crypto và tài chính truyền thống |
| Cooperation and Strategy | **Partnership & Adoption** (Đối tác & Chấp nhận sử dụng) | Crypto quan tâm "adoption" (mức độ chấp nhận sử dụng rộng rãi) hơn |
| Risks and Warnings | **Risk & Warning** (Rủi ro & Cảnh báo) | Thêm hack (tấn công), rug pull (lừa đảo rút vốn), exchange insolvency (sàn phá sản) — rủi ro đặc thù crypto |

---

## Toàn bộ taxonomy crypto (`src/data/taxonomy.ts`)

### 1. Regulation & Legal (Quy định & Pháp lý)
- **Regulatory Announcement** — thông báo quy định mới (VD: SEC ra quy tắc mới về crypto)
- **Enforcement Action** — hành động cưỡng chế (VD: SEC kiện Binance)
- **Legislation Progress** — tiến trình lập pháp (VD: dự luật crypto qua Thượng viện)
- **Government Stance** — lập trường chính phủ (VD: Trung Quốc cấm mining)
- **International Sanctions or Bans** — cấm vận/lệnh cấm quốc tế

### 2. Macroeconomic (Kinh tế vĩ mô)
- **Interest Rate Decision** — quyết định lãi suất (VD: Fed tăng/giảm lãi suất)
- **Inflation Data** — dữ liệu lạm phát (VD: CPI Mỹ công bố)
- **Dollar Index Movement** — biến động chỉ số đô la (DXY tăng/giảm)
- **Quantitative Easing or Tightening** — nới lỏng/thắt chặt định lượng (QE/QT)

### 3. Industry Standards & Opinions (Tiêu chuẩn ngành & Ý kiến)
- **Protocol Proposal** — đề xuất giao thức (VD: EIP mới cho Ethereum)
- **Industry Report** — báo cáo ngành (VD: Chainalysis ra báo cáo)
- **Analyst or Influencer Opinion** — ý kiến nhà phân tích/người ảnh hưởng (VD: tweet của Elon Musk)

### 4. Protocol & Product (Giao thức & Sản phẩm)
- **Protocol Upgrade** — nâng cấp giao thức (VD: Ethereum Dencun upgrade)
- **New Feature Launch** — ra mắt tính năng mới
- **Testnet or Mainnet Launch** — ra mắt mạng thử nghiệm/mạng chính
- **Adoption Metric Change** — thay đổi chỉ số chấp nhận (VD: số ví active tăng)
- **Fee or Gas Change** — thay đổi phí giao dịch/gas
- **Hash Rate Change** — thay đổi tốc độ băm (hash rate tăng/giảm)
- **Supply Dynamics** — động lực cung (VD: Bitcoin halving, token burn)

### 5. Technology & Development (Công nghệ & Phát triển)
- **Technical Breakthrough** — đột phá kỹ thuật (VD: zero-knowledge proof mới)
- **Development Milestone** — cột mốc phát triển
- **Audit or Certification** — kiểm toán/chứng nhận (VD: smart contract audit)
- **Node or Validator Update** — cập nhật nút/trình xác thực
- **Ecosystem Integration** — tích hợp hệ sinh thái (VD: Chainlink tích hợp thêm chain)
- **Developer Tooling** — công cụ phát triển

### 6. Exchange & Trading (Sàn giao dịch & Giao dịch)
- **Listing or Delisting** — niêm yết/hủy niêm yết (VD: Coinbase list token mới)
- **Funding Round** — vòng gọi vốn (VD: startup crypto gọi Series A)
- **Revenue Report** — báo cáo doanh thu (VD: Coinbase công bố Q4 earnings)
- **Acquisition** — thâu tóm/mua lại
- **Partnership Deal** — thỏa thuận đối tác
- **Custody Agreement** — thỏa thuận lưu ký (VD: ngân hàng giữ hộ BTC)
- **Liquidation Event** — sự kiện thanh lý (VD: $500M bị liquidate trên futures)
- **Reserve Proof** — bằng chứng dự trữ (VD: Tether công bố proof-of-reserves)

### 7. DeFi & Ecosystem (Tài chính phi tập trung & Hệ sinh thái)
- **Protocol Launch** — ra mắt giao thức DeFi mới
- **Protocol Migration** — di chuyển giao thức (VD: Uniswap chuyển sang chain mới)
- **Cross-chain Expansion** — mở rộng đa chuỗi

### 8. Whale & On-chain (Cá voi & Dữ liệu trên chuỗi)
- **Whale Accumulation** — cá voi tích lũy (mua vào lượng lớn)
- **Whale Distribution** — cá voi phân phối (bán ra lượng lớn)
- **On-chain Flow Anomaly** — bất thường dòng tiền trên chuỗi (VD: BTC chuyển ồ ạt vào sàn)
- **Miner Selling** — thợ đào bán ra

### 9. Key Figures (Nhân vật chủ chốt)
- **Executive Appointment** — bổ nhiệm lãnh đạo (VD: Binance có CEO mới)
- **Founder Statement** — phát ngôn của người sáng lập
- **Legal Action Against Individual** — hành động pháp lý nhắm vào cá nhân (VD: truy tố Do Kwon)

### 10. Market Performance (Diễn biến thị trường)
- **Market Cap Milestone** — cột mốc vốn hóa (VD: BTC vượt $1T)
- **Sector Rotation** — xoay vòng ngành (VD: dòng tiền chuyển từ meme sang DeFi)
- **BTC Dominance Shift** — thay đổi tỷ trọng BTC (BTC.D tăng/giảm)
- **Volume Surge** — khối lượng giao dịch tăng đột biến
- **ETF Flow** — dòng vốn ETF (VD: Bitcoin ETF inflow $500M)
- **Institutional View** — quan điểm tổ chức lớn (VD: BlackRock nhận xét về BTC)

### 11. TradFi Crossover (Giao thoa tài chính truyền thống)
- **Stock Correlation** — tương quan với cổ phiếu (VD: BTC đi theo Nasdaq)
- **Bond Signal** — tín hiệu từ trái phiếu (VD: lợi suất Treasury tăng)
- **Commodity Correlation** — tương quan với hàng hóa (VD: vàng tăng, BTC theo)
- **Stablecoin Flow** — dòng chảy stablecoin (VD: USDT mint $1B)

### 12. Partnership & Adoption (Đối tác & Chấp nhận sử dụng)
- **Strategic Partnership** — đối tác chiến lược (VD: Visa hợp tác với Ethereum)
- **Payment Integration** — tích hợp thanh toán (VD: PayPal chấp nhận BTC)
- **Institutional Adoption** — tổ chức lớn chấp nhận (VD: Tesla mua BTC)
- **Alliance Formation** — thành lập liên minh

### 13. Risk & Warning (Rủi ro & Cảnh báo)
- **Security Breach or Hack** — vi phạm bảo mật/tấn công (VD: sàn bị hack mất $100M)
- **Rug Pull or Scam** — lừa đảo rút vốn (VD: dự án biến mất cùng tiền nhà đầu tư)
- **Regulatory Risk** — rủi ro quy định (VD: tin đồn SEC sắp siết chặt)
- **Systemic Risk** — rủi ro hệ thống (VD: sụp đổ kiểu Terra/LUNA)
- **Exchange Insolvency** — sàn giao dịch mất khả năng thanh toán (VD: FTX phá sản)

---

## Taxonomy được dùng ở đâu trong pipeline?

### 1. Step 1 — Extraction (trích xuất, prompt cho LLM)

```ts
formatTaxonomyForPrompt() // trả về:
//   groups: "Regulation & Legal, Macroeconomic, ..."
//   typeList:
//     Regulation & Legal: Regulatory Announcement, Enforcement Action, ...
//     Macroeconomic: Interest Rate Decision, Inflation Data, ...
//     ...
```

LLM đọc taxonomy này và phân loại mỗi sự kiện vào đúng group + type.

### 2. Step 2 — Merging (gộp sự kiện)

Raw events (sự kiện thô) được **nhóm theo `event_group`** trước khi cluster (phân cụm) + merge (gộp). Chỉ merge sự kiện trong cùng group.

### 3. Step 5 — Retrieval (truy xuất, binary vectors cho Jaccard)

```ts
// Type vector (véc-tơ loại): 56 chiều, mỗi chiều = 1 type
V_t = [0, 1, 0, 0, 1, ...]  // 1 = type này xuất hiện trong ngày t

// Group vector (véc-tơ nhóm): 13 chiều, mỗi chiều = 1 group
G_t = [1, 0, 1, 0, ...]     // 1 = group này có sự kiện trong ngày t
```

Ví dụ ngày 2025-03-15 có các sự kiện:
- "Regulatory Announcement" (group: Regulation & Legal)
- "Interest Rate Decision" (group: Macroeconomic)
- "Whale Accumulation" (group: Whale & On-chain)

-> `type_vector[0] = 1, type_vector[4] = 1, type_vector[30] = 1, ...` (các type tương ứng)
-> `group_vector[0] = 1, group_vector[1] = 1, group_vector[7] = 1` (3 groups)

Sau đó tính:
```
DailySim = 0.7 * Jaccard(type_vec_A, type_vec_B) + 0.3 * Jaccard(group_vec_A, group_vec_B)
```

**Tại sao dùng cả 2 cấp?** Vì group cho "bức tranh tổng thể" về độ tương đồng (cùng chủ đề rộng), còn type cho so khớp "chi tiết" hơn (cùng loại sự kiện cụ thể). Alpha = 0.7 nghĩa là **type quan trọng hơn group** (70% so với 30%).
