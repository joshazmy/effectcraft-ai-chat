#!/usr/bin/env python3
"""Unit tests for the bridge's ACP model matcher (`pick_model`), run without
spawning an agent:  python3 -m unittest tests/test_model_matching.py -v
"""
import importlib.util
import sys
import unittest
from pathlib import Path

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("agent_bridge", root / "bridge" / "agent-bridge.py")
bridge = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bridge
spec.loader.exec_module(bridge)

pick_model = bridge.pick_model

DEVIN_OPTIONS = [
    {"id": "model", "category": "model", "type": "select",
     "options": [
         {"value": "claude-sonnet-5-5-medium", "name": "Claude Sonnet 5.5"},
         {"value": "claude-opus-5-5-medium", "name": "Claude Opus 5.5"},
         {"value": "claude-haiku-5-5-medium", "name": "Claude Haiku 5.5"},
         {"value": "gpt-6-astra-medium", "name": "GPT-6 Astra"},
         {"value": "gemini-3-8-flash-medium", "name": "Gemini 3.8 Flash"},
     ]},
    {"id": "mode", "category": "mode", "type": "select",
     "options": [{"value": "plan", "name": "Plan"}, {"value": "act", "name": "Act"}]},
]


class PickModel(unittest.TestCase):
    def test_exact_value_match_wins(self):
        self.assertEqual(
            pick_model(DEVIN_OPTIONS, "Claude-Opus-5-5-Medium"),
            ("model", "claude-opus-5-5-medium"))

    def test_substring_picks_the_first_matching_option(self):
        # "opus" is a substring of the Opus value only; list order decides between candidates.
        self.assertEqual(pick_model(DEVIN_OPTIONS, "opus"), ("model", "claude-opus-5-5-medium"))
        # "claude" matches several values; the first in the list wins.
        self.assertEqual(pick_model(DEVIN_OPTIONS, "claude"), ("model", "claude-sonnet-5-5-medium"))

    def test_substring_matches_the_name_too(self):
        options = [{"id": "model", "category": "model", "type": "select",
                    "options": [{"value": "m-9-fast", "name": "Gemini Flash"}]}]
        self.assertEqual(pick_model(options, "gemini"), ("model", "m-9-fast"))

    def test_no_match_lists_the_available_values(self):
        with self.assertRaises(RuntimeError) as ctx:
            pick_model(DEVIN_OPTIONS, "llama")
        msg = str(ctx.exception)
        self.assertIn("'llama'", msg)
        self.assertIn("claude-sonnet-5-5-medium", msg)

    def test_no_match_lists_at_most_eight_values(self):
        many = [{"id": "model", "category": "model",
                 "options": [{"value": "m%d" % i, "name": "m%d" % i} for i in range(12)]}]
        with self.assertRaises(RuntimeError) as ctx:
            pick_model(many, "nope")
        self.assertIn("m7", str(ctx.exception))
        self.assertNotIn("m8", str(ctx.exception))

    def test_no_model_option(self):
        options = [{"id": "mode", "category": "mode",
                    "options": [{"value": "plan", "name": "Plan"}]}]
        with self.assertRaises(RuntimeError) as ctx:
            pick_model(options, "opus")
        self.assertIn("doesn't offer a model choice", str(ctx.exception))

    def test_empty_config_options(self):
        for empty in (None, []):
            with self.assertRaises(RuntimeError):
                pick_model(empty, "opus")

    def test_id_fallback_when_no_category(self):
        options = [{"id": "model", "type": "select",
                    "options": [{"value": "only-model", "name": "Only"}]}]
        self.assertEqual(pick_model(options, "only"), ("model", "only-model"))


if __name__ == "__main__":
    unittest.main()
