"""Read the Education Department's purchase orders week by week, one session per week, into out/."""
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script's folder off the path
import wd_probe  # noqa: E402

FIRST_MONDAY = date(2026, 4, 27)
LAST_DAY = date(2026, 11, 18)


def main() -> int:
    monday, failures = FIRST_MONDAY, 0
    while monday <= LAST_DAY:
        sunday = min(monday + timedelta(days=6), LAST_DAY)
        start, end = monday.strftime("%d.%m.%Y"), sunday.strftime("%d.%m.%Y")
        t0 = time.time()
        try:
            result = wd_probe.run(wd_probe.Client("runner"), start, end, "30")
        except Exception as e:  # outermost: record the week as failed and go on
            failures += 1
            print(f"{start}-{end} FAILED {type(e).__name__}: {str(e)[:200]}", flush=True)
        else:
            Path(f"out/w_{monday.isoformat()}.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"{start}-{end} rowcount {result['rowcount']} read {result['read']} "
                  f"requests {result['requests']} {time.time() - t0:.0f}s", flush=True)
        monday += timedelta(days=7)
        time.sleep(3)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
