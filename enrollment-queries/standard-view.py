"""Standard enrollment view — 4 columns (Mon, Tue, Thu, Fri), students sorted youngest to oldest.

Dan's default dashboard view for homeschool enrollment.
Run: python3 standard-view.py

Data source: data/migration_rows.json (snapshot from Cognito migration).
Once the Apps Script migration lands and writes into the live Google Sheet,
this script will be upgraded to pull from the sheet's CSV export endpoint
so the view is always live.
"""
import json
import os
from datetime import date, datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(SCRIPT_DIR, 'data', 'migration_rows.json')

DAY_NAMES = {
    'Monday': 'Performing Arts',
    'Tuesday': 'Science & Social Studies',
    'Thursday': 'Life Skills',
    'Friday': 'Technology',
}


def age_as_of(dob_str, ref=None):
    if not dob_str:
        return None
    ref = ref or date.today()
    d = datetime.strptime(dob_str, '%Y-%m-%d').date()
    return ref.year - d.year - ((ref.month, ref.day) < (d.month, d.day))


def collect_students_by_day(rows, ref_date=None):
    days = {d: [] for d in DAY_NAMES}
    for r in rows:
        for i in range(1, 7):
            name = r.get(f'C{i} Name', '')
            if not name:
                continue
            a = age_as_of(r.get(f'C{i} DOB', ''), ref_date)
            progs = r.get(f'C{i} Programs', '')
            for d in days:
                if d in progs:
                    days[d].append((name, a))
    # Sort each column by age ascending, then name
    for d in days:
        days[d].sort(key=lambda x: (x[1] if x[1] is not None else 999, x[0]))
    return days


def render(days, col=28):
    headers = list(DAY_NAMES.keys())
    # Row 1: day
    print(''.join(f'{d.upper():<{col}}' for d in headers))
    # Row 2: subject
    print(''.join(f'{DAY_NAMES[d]:<{col}}' for d in headers))
    # Row 3: count
    print(''.join(f'({len(days[d])} students){"":<{col-len("("+str(len(days[d]))+" students)")}}' for d in headers))
    print('-' * (col * len(headers)))

    maxlen = max(len(v) for v in days.values()) if days else 0
    for i in range(maxlen):
        line = ''
        for d in headers:
            if i < len(days[d]):
                name, a = days[d][i]
                cell = f'{name} ({a})'
            else:
                cell = ''
            line += f'{cell:<{col}}'
        print(line)


def main():
    with open(DATA_PATH) as f:
        rows = json.load(f)
    days = collect_students_by_day(rows)
    total = sum(len(v) for v in days.values())
    uniq = set()
    for v in days.values():
        for name, _ in v:
            uniq.add(name)
    print(f'HOMESCHOOL ENROLLMENT — 2026-27 SCHOOL YEAR')
    print(f'{len(uniq)} unique students · {total} student-days enrolled')
    print()
    render(days)


if __name__ == '__main__':
    main()
