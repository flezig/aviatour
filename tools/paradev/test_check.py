import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from destination_check import COUNTRIES, MONTHS, ORIGINS, evaluate, matrix
from meter import RolloutMeter


class HarnessTests(unittest.TestCase):
    def test_meter_reads_partial_record_once(self):
        record = {'type': 'token_usage_record', 'payload': {'thread_id': 'worker', 'response_id': 'r1',
                  'usage': {'input_tokens': 80, 'cached_input_tokens': 60, 'output_tokens': 4}}}
        data = json.dumps(record).encode()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'log'
            path.write_bytes(data[:12])
            meter = RolloutMeter('worker')
            self.assertEqual(meter.update(path)['requests'], 0)
            with path.open('ab') as out:
                out.write(data[12:] + b'\n' + data + b'\n')
            self.assertEqual(meter.update(path)['total'], 84)
            pos = meter.offset
            self.assertEqual(meter.update(path)['requests'], 1)
            self.assertEqual(pos, meter.offset)
            self.assertEqual(meter.update(path)['uncached'], 20)

    def test_country_threshold_requires_spread_and_distinct_dates(self):
        rows = {f'{o}/{m}/asia': {'groups': {'uae': {'dates': ['day1', 'day2']}}}
                for o in ORIGINS for m in MONTHS}
        self.assertTrue(evaluate(rows, 'asia', 'uae')['accepted'])
        for m in MONTHS[:2]:
            rows['MOW/'+m+'/asia']['groups']['uae']['dates'] = ['day1', 'day1']
        result = evaluate(rows, 'asia', 'uae')
        self.assertEqual(result['cells'], 10)
        self.assertFalse(result['accepted'])

    def test_resume_keeps_completed_queries(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).isoformat()
            rows = {f'{o}/{m}/{r}': {'checked_at': now} for o in ORIGINS for m in MONTHS for r in ('asia', *COUNTRIES)}
            (root/'observations.json').write_text(json.dumps(rows))
            with patch('destination_check.collect', side_effect=AssertionError('повторный HTTP-запрос')):
                self.assertEqual(matrix(root), rows)

if __name__ == '__main__':
    unittest.main()
