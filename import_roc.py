#!/usr/bin/env python3
from pathlib import Path
import argparse, csv, re, shutil
from datetime import datetime, timezone

def canonical(v):
    s=(v or "").upper()
    s=re.sub(r"[.,]", " ", s)
    s=re.sub(r"\s+", " ", s).strip()
    s=re.sub(r"\bL L C\b", "LLC", s)
    s=re.sub(r"\bINCORPORATED\b", "INC", s)
    s=re.sub(r"\bCORPORATION\b", "CORP", s)
    s=re.sub(r"\s+(LLC|INC|CORP|CO|LTD)\s*$", r" \1", s).strip()
    return s

def norm_header(s):
    return re.sub(r"[^a-z0-9]+","", (s or "").lower())

def sq(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

ap=argparse.ArgumentParser(description="Generate chunked D1 SQL from Arizona ROC All Current Contractors CSV.")
ap.add_argument("csv_file")
ap.add_argument("--as-of", dest="as_of")
ap.add_argument("--batch-size", type=int, default=4000)
args=ap.parse_args()

src=Path(args.csv_file)
if not src.exists():
    raise SystemExit(f"File not found: {src}")

as_of=args.as_of
if not as_of:
    m=re.search(r"(20\d{2}-\d{2}-\d{2})", src.name)
    as_of=m.group(1) if m else datetime.now(timezone.utc).date().isoformat()

batch=f"AZROC-{as_of}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
outdir=Path("roc_sql")
if outdir.exists():
    shutil.rmtree(outdir)
outdir.mkdir()

with src.open("r", encoding="utf-8-sig", newline="", errors="replace") as f:
    reader=csv.DictReader(f)
    if not reader.fieldnames:
        raise SystemExit("CSV has no header row.")
    headers={norm_header(h):h for h in reader.fieldnames}
    aliases={
      "license_no":["licenseno","licensenumber","roclicense","rocno"],
      "business_name":["businessname","companyname","name"],
      "dba":["doingbusinessas","dba"],
      "class_code":["class","classcode","classification"],
      "class_detail":["classdetail","classificationdetail"],
      "class_type":["classtype","classificationtype"],
      "address":["address","businessaddress"],
      "city":["city"],
      "state":["state"],
      "zip":["zip","zipcode","postalcode"],
      "qualifying_party":["qualifyingparty","qp"],
      "issued_date":["issueddate","issued"],
      "expiration_date":["expirationdate","expires","expiration"],
      "status":["status","licensestatus"],
    }
    def col(key):
        for a in aliases[key]:
            if a in headers:
                return headers[a]
        return None
    cols={k:col(k) for k in aliases}
    missing=[k for k in ("license_no","business_name") if not cols[k]]
    if missing:
        raise SystemExit("Required column(s) not found: "+", ".join(missing)+"\nHeaders: "+", ".join(reader.fieldnames))

    rows=[]
    for r in reader:
        lic=(r.get(cols["license_no"]) or "").strip()
        name=(r.get(cols["business_name"]) or "").strip()
        if not lic or not name:
            continue
        def get(k):
            c=cols.get(k)
            return (r.get(c) or "").strip() if c else ""
        dba=get("dba")
        vals=[
          lic,name,dba,get("class_code"),get("class_detail"),get("class_type"),
          get("address"),get("city"),get("state"),get("zip"),get("qualifying_party"),
          get("issued_date"),get("expiration_date"),get("status"),
          canonical(name),canonical(dba) if dba else "",batch,as_of
        ]
        rows.append(vals)

columns=("license_no,business_name,dba,class_code,class_detail,class_type,address,city,state,zip,"
         "qualifying_party,issued_date,expiration_date,status,canonical_name,canonical_dba,import_batch,source_as_of")

for n,start in enumerate(range(0,len(rows),args.batch_size),1):
    chunk=rows[start:start+args.batch_size]
    values=",\n".join("(" + ",".join(sq(v) for v in row) + ")" for row in chunk)
    sql=f"-- AZ ROC {batch} chunk {n}\nINSERT OR REPLACE INTO roc_licenses ({columns}) VALUES\n{values};\n"
    (outdir/f"{n:03d}.sql").write_text(sql,encoding="utf-8")

activate=(
    "-- Activate only after every chunk has imported successfully.\n"
    f"UPDATE roc_import_meta SET active_batch={sq(batch)}, source_as_of={sq(as_of)}, "
    f"record_count={len(rows)}, source_file={sq(src.name)}, imported_at=datetime('now') WHERE id=1;\n\n"
    f"DELETE FROM roc_licenses WHERE import_batch <> {sq(batch)};\n"
)
Path("roc_activate.sql").write_text(activate,encoding="utf-8")

ps = """$ErrorActionPreference = "Stop"
Write-Host "Importing Arizona ROC roster chunks into RevenueTrigger D1..." -ForegroundColor Green
$files = Get-ChildItem ".\\roc_sql\\*.sql" | Sort-Object Name
foreach ($file in $files) {
  Write-Host ("Importing " + $file.Name)
  npx wrangler d1 execute signalhound --remote --file=$file.FullName
  if ($LASTEXITCODE -ne 0) { throw ("ROC import failed at " + $file.Name + ". Active roster was NOT changed.") }
}
Write-Host "All chunks succeeded. Activating the new ROC roster..." -ForegroundColor Green
npx wrangler d1 execute signalhound --remote --file=".\\roc_activate.sql"
if ($LASTEXITCODE -ne 0) { throw "Activation failed. Previous active batch remains authoritative until activation succeeds." }
Write-Host "Arizona ROC roster activated." -ForegroundColor Green
"""
Path("import_roc.ps1").write_text(ps,encoding="utf-8")

print(f"Parsed {len(rows):,} ROC license rows")
print(f"Batch: {batch}")
print(f"As of: {as_of}")
print(f"Generated {len(list(outdir.glob('*.sql')))} SQL chunks")
print("Next: .\\import_roc.ps1")
