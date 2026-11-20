import importlib.util
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from discussion import decision, END, read_card, run
from meter import write_json


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('start_team', ROOT / 'start-team.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class DiscussionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        write_json(self.folder / 'card.json', read_card(ROOT / 'kazan-results.json'))

    def test_wait_for_both_judges_and_keep_dissent(self):
        card = read_card(self.folder / 'card.json')
        card['models'] = {'designer': 'sol', 'ux_judge': 'sol'}
        write_json(self.folder / 'card.json', card)
        arrived = threading.Event()
        release = threading.Event()
        prompts = {}
        def worker(folder, role, prompt, settings, *, card_only):
            self.assertTrue(card_only)
            self.assertEqual(settings[:2], ('astra' if role == 'data_judge' else 'sol', 'xhigh'))
            self.assertNotIn('models', prompt)
            prompts[role] = prompt
            if role == 'data_judge':
                arrived.set()
                if not release.wait(5):
                    raise RuntimeError('Тест не отпустил судью')
            vote = 'CALENDAR' if role == 'ux_judge' else 'LIST'
            (folder / (role + '.md')).write_text(f'CHOICE {vote}\nunique_{role}\n{END}')
            write_json(folder / (role + '.usage.json'), {'thread': role, 'total': 10})

        job = threading.Thread(target=run, args=(self.folder, worker))
        job.start()
        try:
            self.assertTrue(arrived.wait(5))
            self.assertFalse((self.folder / 'result.json').exists())
        finally:
            release.set()
            job.join(5)
        result = json.loads((self.folder / 'result.json').read_text())
        self.assertEqual(result['state'], 'complete')
        self.assertEqual(result['choices'], {'designer': 'LIST', 'ux_judge': 'CALENDAR', 'data_judge': 'LIST'})
        for role in ('ux_judge', 'data_judge'):
            self.assertNotIn('unique_designer', prompts[role])
            self.assertIn('417', prompts[role])
            self.assertNotIn('unique_ux_judge', prompts[role])
            self.assertNotIn('unique_data_judge', prompts[role])
        write_json(self.folder / 'launch.json', {'kind': 'discussion'})
        with patch.object(launcher, 'dispatch', side_effect=AssertionError('Повторный запуск')), \
                patch.object(sys, 'argv', ['start-team.py', '--receipt', str(self.folder)]), \
                redirect_stdout(io.StringIO()) as captured:
            launcher.main()
        self.assertIn('CALENDAR', captured.getvalue())
        self.assertEqual(run(self.folder, None), result)

    def test_designer_failure_preserves_usage_and_skips_judges(self):
        called = []
        def worker(folder, role, *args, **kwargs):
            called.append(role)
            write_json(folder / (role + '.usage.json'), {'total': 150})
            raise RuntimeError('Сбой дизайнера')
        result = run(self.folder, worker)
        self.assertEqual(called, ['designer'])
        self.assertEqual(result['state'], 'failed')
        self.assertEqual(result['agents']['designer']['total'], 150)

    def test_reject_oversize_card_and_unknown_vote(self):
        card = json.loads((self.folder / 'card.json').read_text())
        card['facts'] = ['я' * 2400]
        write_json(self.folder / 'card.json', card)
        with self.assertRaises(ValueError):
            read_card(self.folder / 'card.json')
        with self.assertRaises(ValueError):
            decision('CHOICE MISSING\ntext\n' + END, card['options'])


if __name__ == '__main__':
    unittest.main()
