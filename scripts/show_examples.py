import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
m = json.load(open(ROOT / "public" / "data" / "whitespace_master.json", encoding="utf-8"))
vr = json.load(open(Path(__file__).resolve().parent / "verification_report.json", encoding="utf-8"))

# State-level computations from the raw data
bh = [d for d in m if d["state_name"] == "Bihar"]
mh = [d for d in m if d["state_name"] == "Maharashtra"]

bh_pop = sum(d["total_population"] for d in bh)
mh_pop = sum(d["total_population"] for d in mh)

bh_hr = sum(d["headcount_ratio_2021"] * d["total_population"] for d in bh) / bh_pop * 100
mh_hr = sum(d["headcount_ratio_2021"] * d["total_population"] for d in mh) / mh_pop * 100

bh_csr_total = sum(d["total_csr_recent"] for d in bh)
mh_csr_total = sum(d["total_csr_recent"] for d in mh)

bh_csr_pp = bh_csr_total / bh_pop
mh_csr_pp = mh_csr_total / mh_pop

print("=== STATE-LEVEL VERIFICATION (computed from whitespace_master.json) ===")
print(f"Bihar:       {len(bh)} districts, pop={bh_pop:,.0f}, HR={bh_hr:.2f}%, CSR/person=Rs {bh_csr_pp:.2f}")
print(f"Maharashtra: {len(mh)} districts, pop={mh_pop:,.0f}, HR={mh_hr:.2f}%, CSR/person=Rs {mh_csr_pp:.2f}")
print(f"HR ratio (Bihar/Maha):           {bh_hr/mh_hr:.2f}x")
print(f"CSR/person ratio (Maha/Bihar):   {mh_csr_pp/bh_csr_pp:.2f}x")

print()
print("=== CROSS-CHECK: verification_report.json says ===")
print(f"Bihar HR:    {vr['bihar']['hr_2019_21_pop_weighted_pct']}%")
print(f"Maha HR:     {vr['maharashtra']['hr_2019_21_pop_weighted_pct']}%")
print(f"HR ratio:    {vr['ratios']['bihar_vs_maharashtra_hr_pop_weighted']}x")
print(f"CSR/p ratio: {vr['ratios']['maharashtra_vs_bihar_csr_per_person']}x")

# Whitespace distribution
ws = [d for d in m if d["is_whitespace"]]
ws_by_state = {}
for d in ws:
    ws_by_state[d["state_name"]] = ws_by_state.get(d["state_name"], 0) + 1
print(f"\n=== WHITESPACE DISTRICTS: {len(ws)} total ===")
for state, count in sorted(ws_by_state.items(), key=lambda x: -x[1]):
    print(f"  {state}: {count}")
