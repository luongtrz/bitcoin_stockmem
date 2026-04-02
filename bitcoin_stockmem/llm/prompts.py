"""Prompt templates for the 6 LLM calls in the StockMem pipeline.

Templates closely follow the paper's Appendix B (StockMem.tex lines 905-955),
adapted for cryptocurrency markets (BTC / ETH).
"""

# ---------------------------------------------------------------------------
# 1. LLM_ext — Event extraction from a news article
# ---------------------------------------------------------------------------
EXTRACT_PROMPT = """\
You are a cryptocurrency market analyst. Extract all distinct events from the \
following news article(s) related to cryptocurrency markets.

For each event, output a JSON object with these fields:
- event_group: one of [{groups}]
- event_type: the specific type within that group (see list below)
- time: when the event occurred (YYYY-MM-DD or "unknown")
- location: country/region or "global"
- entities: list of participating entities (companies, protocols, people)
- industries: list of relevant sectors
- description: 2-3 sentence factual summary of the event

Valid event types per group:
{type_list}

=== News Article(s) ===
{articles}

Output a JSON array of event objects. If no relevant crypto events, output [].
"""

# ---------------------------------------------------------------------------
# 2. LLM_merge — Merge duplicate / overlapping events within a cluster
# ---------------------------------------------------------------------------
MERGE_PROMPT = """\
You are analyzing a cluster of potentially related cryptocurrency events from \
the same day ({date}). Determine:

1. Are these describing the same underlying event, or are they distinct?
2. For events that are the same, merge them into a single unified description \
   that preserves all important details from each source.
3. Assign the correct event_type for each resulting event.

Events in cluster:
{cluster_events_json}

Output a JSON array of merged events. Each merged event must have:
- event_group: str
- event_type: str
- time: str
- location: str
- entities: list of str
- industries: list of str
- description: str (unified, 2-3 sentences)
- source_event_ids: list of int (which input event IDs were merged)
"""

# ---------------------------------------------------------------------------
# 3. LLM_track — Event chain construction + incremental info extraction
# ---------------------------------------------------------------------------
TRACK_PROMPT = """\
You are tracking the evolution of a cryptocurrency market event. Given the \
current event and a list of candidate predecessor events from the past \
{window} days, determine:

1. Does the current event have a direct predecessor (same underlying event, \
   earlier occurrence)?
2. If yes, what is the incremental information (ΔInfo) — new developments \
   or changes compared to the predecessor? Focus on what is NEW or CHANGED, \
   and whether it shifts expectations positively, negatively, or neutrally.

Current event (ID={current_id}, date={current_date}):
{current_event_json}

Candidate predecessors:
{candidates_json}

Output JSON:
{{
  "has_predecessor": true/false,
  "predecessor_id": <int or null>,
  "delta_info": "<description of what is new/changed, or null>"
}}
"""

# ---------------------------------------------------------------------------
# 4. LLM_reason — Reflection generation (training phase)
#    Adapted from paper's exact train prompt (StockMem.tex lines 906-928)
# ---------------------------------------------------------------------------
REASON_PROMPT = """\
You are a cryptocurrency analyst specializing in {asset}. You need to \
interpret the driving factors behind tomorrow's price movement based on \
the following analytical elements.

Analytical Elements: Recent event sequence and today's incremental information.

Logic of the Analytical Elements:

The recent event sequence outlines events within a recent time window that \
may impact tomorrow's price.

Incremental information refers to new developments or changes in an event \
compared to its past occurrences, indicating whether it has become more \
positive/negative/neutral.

Price movements depend not only on the absolute nature of the information \
(positive/negative) but also on the degree of deviation from existing market \
expectations (exceeding expectations/falling short of expectations). \
Incremental information reflects this deviation from market expectations.

=== Events and Incremental Information ===
{information}

=== Actual Direction of Tomorrow's Price Change ===
{price_change}

Please analyze the basis for the price change based on the given events and \
incremental information (within 500 words) and specify which events \
contributed to the price change (within 300 words).

Output strictly in the following JSON format:
{{"Reason for price movement": "...", "Events causing the impact": "..."}}
"""

# ---------------------------------------------------------------------------
# 5. LLM_retrieve — Fine-grained filtering of candidate historical sequences
# ---------------------------------------------------------------------------
RETRIEVE_PROMPT = """\
You are comparing cryptocurrency event sequences to determine which \
historical patterns are truly analogous to the current market situation.

Current event sequence (past {window} days) for {asset}:
{current_series_text}

Candidate historical sequences (with their subsequent market outcomes):
{candidates_with_reflections}

For each candidate, judge whether it represents a genuinely analogous market \
situation that provides useful reference for predicting the current outcome. \
Consider event types, market context, and the nature of information flow.

Output JSON:
{{"selected_indices": [<list of 0-based candidate indices that are valid references>]}}
"""

# ---------------------------------------------------------------------------
# 6. LLM_predict — Final prediction
#    Adapted from paper's exact test prompt (StockMem.tex lines 930-955)
# ---------------------------------------------------------------------------
PREDICT_PROMPT = """\
You are a cryptocurrency analyst specializing in {asset}. You need to predict \
tomorrow's price movement (up/down) based on the following analytical elements.

Analytical Elements: Recent event sequence, today's incremental information, \
and relevant historical reference experience.

Logic of the Analytical Elements:

The recent event sequence outlines events within a recent time window that \
may impact tomorrow's price.

Incremental information refers to new developments or changes in an event \
compared to its past occurrences, indicating whether it has become more \
positive/negative/neutral.

Price movements depend not only on the absolute nature of the information \
(positive/negative) but also on the degree of deviation from existing market \
expectations (exceeding expectations/falling short of expectations). \
Incremental information reflects this deviation from market expectations.

Historical reference experience includes similar event sequence patterns \
matched from historical data based on the characteristics of the current \
event sequence. These historical similar sequences contain events and \
incremental information from that period, along with their corresponding \
subsequent price movements, reflecting how the market typically reacts to \
various types of information in similar situations.

=== Events and Incremental Information ===
{information}

=== Historical Reference Experience ===
{hist_reflection}

Please refer to the historical experience and predict the price change based \
on the given events and incremental information. Analyze the basis for the \
price movement (within 500 words).

Output strictly in the following JSON format:
{{"Reason for price movement": "...", "Price movement": "up/down"}}
"""
