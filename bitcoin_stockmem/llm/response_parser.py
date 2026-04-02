"""Pydantic models for validating LLM JSON responses."""

from __future__ import annotations
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Step 1: Event extraction
# ---------------------------------------------------------------------------
class ExtractedEvent(BaseModel):
    event_group: str
    event_type: str
    time: str = "unknown"
    location: str = "global"
    entities: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    description: str
    extended_attrs: dict = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Step 2: Event merging
# ---------------------------------------------------------------------------
class MergedEvent(BaseModel):
    event_group: str
    event_type: str
    time: str = "unknown"
    location: str = "global"
    entities: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    description: str
    source_event_ids: list[int] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Step 3: Event tracking
# ---------------------------------------------------------------------------
class TrackResult(BaseModel):
    has_predecessor: bool
    predecessor_id: int | None = None
    delta_info: str | None = None


# ---------------------------------------------------------------------------
# Step 4: Reflection / Reason
# ---------------------------------------------------------------------------
class ReasonResult(BaseModel):
    reason: str = Field(alias="Reason for price movement")
    key_events: str = Field(alias="Events causing the impact")


# ---------------------------------------------------------------------------
# Step 5: Retrieval filter
# ---------------------------------------------------------------------------
class RetrieveResult(BaseModel):
    selected_indices: list[int]


# ---------------------------------------------------------------------------
# Step 6: Prediction
# ---------------------------------------------------------------------------
class PredictResult(BaseModel):
    reason: str = Field(alias="Reason for price movement")
    direction: str = Field(alias="Price movement")


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------
def parse_extracted_events(data: list[dict]) -> list[ExtractedEvent]:
    """Parse a list of dicts into ExtractedEvent models, skipping invalid."""
    results = []
    for item in data:
        try:
            results.append(ExtractedEvent(**item))
        except Exception:
            continue
    return results


def parse_merged_events(data: list[dict]) -> list[MergedEvent]:
    results = []
    for item in data:
        try:
            results.append(MergedEvent(**item))
        except Exception:
            continue
    return results


def parse_track_result(data: dict) -> TrackResult:
    return TrackResult(**data)


def parse_reason_result(data: dict) -> ReasonResult:
    return ReasonResult(**data)


def parse_retrieve_result(data: dict) -> RetrieveResult:
    return RetrieveResult(**data)


def parse_predict_result(data: dict) -> PredictResult:
    return PredictResult(**data)
