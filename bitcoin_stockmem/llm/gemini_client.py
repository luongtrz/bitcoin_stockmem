"""Gemini 2.5 Flash API wrapper with rate limiting and structured output."""

import json
import time
import logging

import google.generativeai as genai

from config import (
    GEMINI_API_KEY, GEMINI_MODEL, GEMINI_RPM,
    GEMINI_RETRY_DELAY, GEMINI_MAX_RETRIES, GEMINI_TEMPERATURE,
)

logger = logging.getLogger(__name__)


class GeminiClient:
    """Thin wrapper around Gemini with token-bucket rate limiting."""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        key = api_key or GEMINI_API_KEY
        if not key:
            raise ValueError(
                "GEMINI_API_KEY not set. Pass it or set the env var."
            )
        genai.configure(api_key=key)
        self._model_name = model or GEMINI_MODEL
        self._model = genai.GenerativeModel(self._model_name)

        # Rate limiting state
        self._min_interval = 60.0 / GEMINI_RPM
        self._last_request_time = 0.0

    # ------------------------------------------------------------------
    # Rate limiting
    # ------------------------------------------------------------------
    def _wait_for_rate_limit(self):
        elapsed = time.time() - self._last_request_time
        if elapsed < self._min_interval:
            sleep_time = self._min_interval - elapsed
            logger.debug(f"Rate limit: sleeping {sleep_time:.1f}s")
            time.sleep(sleep_time)
        self._last_request_time = time.time()

    # ------------------------------------------------------------------
    # Core generation
    # ------------------------------------------------------------------
    def generate(
        self,
        prompt: str,
        *,
        json_mode: bool = True,
        json_schema: dict | None = None,
        temperature: float | None = None,
    ) -> str:
        """Send a prompt to Gemini and return the text response.

        Args:
            prompt: The input prompt.
            json_mode: Request JSON output from Gemini.
            json_schema: Optional JSON schema for structured output.
            temperature: Override default temperature.

        Returns:
            The model's text response.
        """
        gen_config = {
            "temperature": temperature if temperature is not None else GEMINI_TEMPERATURE,
        }
        if json_mode:
            gen_config["response_mime_type"] = "application/json"
            if json_schema:
                gen_config["response_schema"] = json_schema

        last_error = None
        for attempt in range(1, GEMINI_MAX_RETRIES + 1):
            self._wait_for_rate_limit()
            try:
                response = self._model.generate_content(
                    prompt,
                    generation_config=gen_config,
                )
                text = response.text.strip()
                logger.debug(f"Gemini response ({len(text)} chars)")
                return text
            except Exception as e:
                last_error = e
                wait = GEMINI_RETRY_DELAY * attempt
                logger.warning(
                    f"Gemini attempt {attempt}/{GEMINI_MAX_RETRIES} failed: {e}. "
                    f"Retrying in {wait:.1f}s"
                )
                time.sleep(wait)

        raise RuntimeError(
            f"Gemini failed after {GEMINI_MAX_RETRIES} attempts: {last_error}"
        )

    def generate_json(
        self,
        prompt: str,
        *,
        json_schema: dict | None = None,
    ) -> dict | list:
        """Generate and parse a JSON response."""
        text = self.generate(prompt, json_mode=True, json_schema=json_schema)
        return parse_json_response(text)


def parse_json_response(text: str) -> dict | list:
    """Best-effort JSON extraction from LLM text output."""
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON block in markdown fences
    import re
    match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Try to find first { ... } or [ ... ]
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        start = text.find(start_char)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(text)):
            if text[i] == start_char:
                depth += 1
            elif text[i] == end_char:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break

    raise ValueError(f"Could not parse JSON from response: {text[:200]}...")
