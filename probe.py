"""Reads university result registers and timetable listings from the runner's own address. Examination grain only:
no result PDF, marksheet, gazette, seat number or name is ever requested."""
import json, os, re, ssl, subprocess, time, urllib.parse, urllib.request
from pathlib import Path

OUT = Path('out'); OUT.mkdir(exist_ok=True)
CTX = ssl.create_default_context()
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}
log = []

def get(name, url, tries=3):
    for i in range(tries):
        t0 = time.time()
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
                body = r.read(); st = r.status
        except urllib.error.HTTPError as e:
            body, st = e.read(), e.code
        except Exception as e:
            body, st = repr(e).encode(), -1
        dt = round(time.time() - t0, 1)
        log.append({'name': name, 'url': url, 'try': i + 1, 'status': st, 'bytes': len(body), 'secs': dt})
        print(name, st, len(body), dt, flush=True)
        if st == 200:
            (OUT / name).write_bytes(body)
            return body
        time.sleep(5)
    return None

get('sppu_dash.html', 'https://onlineresults.unipune.ac.in/Result/Dashboard/Default')
get('mu_results.html', 'https://www.mumresults.in/')
for s in ['WINTER-2025', 'SUMMER-2026', 'WINTER-2026', 'SUPPLEMENTARY WINTER-2025']:
    get('rtmnu_' + s.replace(' ', '_') + '.json', 'https://rtmnuresults.uonex.in/GetResultsBySession?session=' + urllib.parse.quote(s))
get('rtmnu_tt_humanities_s26.html', 'https://nagpuruniversity.ac.in/index.php/Contentpage/index/SC9NdnZ1cEdTZnhTWlZNPQ%3D%3D/en')
for cat in (36, 30, 37, 38):
    get(f'mu_tt_cat{cat}_p1.html', f'https://mu.ac.in/examinationtimetable.php?category_id={cat}&page=1&search=')
for code in ['1S02815', '1110461', '1211661']:
    get(f'mu_tt_search_{code}.html', f'https://mu.ac.in/examinationtimetable.php?category_id=36&search={code}')

# OCR test on two timetable scans (the last paper's date lives only inside these images)
pdfs = {'1S02815_W26': 'https://mu.ac.in/admin/upload/circular/405511S02815 T.Y.B.Sc. (Data Science) (Sem V) (Winter 2026).pdf',
        '1T02812_W25': None}
t = (OUT / 'mu_tt_search_1S02815.html').read_text('utf-8', 'replace') if (OUT / 'mu_tt_search_1S02815.html').exists() else ''
ocr = {}
for key, url in pdfs.items():
    if not url: continue
    b = get(f'tt_{key}.pdf', urllib.parse.quote(url, safe=':/'))
    if not b: continue
    t0 = time.time()
    subprocess.run(['pdftoppm', '-r', '200', '-png', str(OUT / f'tt_{key}.pdf'), str(OUT / f'tt_{key}')], check=False)
    txt = ''
    for png in sorted(OUT.glob(f'tt_{key}*.png')):
        r = subprocess.run(['tesseract', str(png), '-', '--psm', '6'], capture_output=True, text=True)
        txt += r.stdout
        png.unlink()
    (OUT / f'tt_{key}.ocr.txt').write_text(txt, 'utf-8')
    dates = re.findall(r'(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(20\d\d)', txt)
    ocr[key] = {'secs': round(time.time() - t0, 1), 'dates': dates}
json.dump({'log': log, 'ocr': ocr}, open(OUT / 'summary.json', 'w'), indent=1)
