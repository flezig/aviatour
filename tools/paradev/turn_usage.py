"""Report deduplicated measurements for one specified desktop turn."""
import argparse
import json
from pathlib import Path


def measure(path, turn, until=None):
    seen = set()
    fields = ('input_tokens', 'cached_input_tokens', 'output_tokens')
    sums = dict.fromkeys(fields, 0)
    first = last = None
    with path.open() as stream:
        for line in stream:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get('type') != 'token_usage_record' or (until and event['timestamp'] > until):
                continue
            record = event['payload']
            key = record.get('response_id')
            if record.get('turn_id') != turn or not key or key in seen:
                continue
            seen.add(key)
            for field in fields:
                sums[field] += record['usage'][field]
            first = first or event['timestamp']
            last = event['timestamp']
    if not seen:
        raise ValueError('Нет измерений для этого хода')
    return dict(**sums, responses=len(seen), first=first, as_of=last,
                total=sums['input_tokens']+sums['output_tokens'],
                new_and_output=sums['input_tokens']-sums['cached_input_tokens']+sums['output_tokens'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('rollout', type=Path)
    parser.add_argument('turn')
    parser.add_argument('--until', help='Граница сравнения в UTC по журналу')
    args = parser.parse_args()
    print(json.dumps(measure(args.rollout, args.turn, args.until)))
