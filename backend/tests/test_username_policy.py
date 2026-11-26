import json
from pathlib import Path
import unittest
from app.services.username_policy import valid_username, username_length


class UsernamePolicyTests(unittest.TestCase):
    def test_shared_client_server_cases(self):
        cases = json.loads((Path(__file__).resolve().parents[2] / 'frontend/shared/username-policy-cases.json').read_text())
        for group, values in cases.items():
            for value in values:
                with self.subTest(value=value):
                    self.assertEqual(valid_username(value), group == 'valid')

    def test_chinese_weight(self):
        self.assertEqual(username_length('演示学习者'), 10)
        self.assertEqual(username_length('物理seed_2026'), 13)
