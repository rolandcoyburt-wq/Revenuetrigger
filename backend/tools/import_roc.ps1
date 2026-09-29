param(
  [Parameter(Mandatory=$true, Position=0)]
  [string]$CsvFile,

  [string]$AsOf = "",

  [int]$BatchSize = 4000
)

$ErrorActionPreference = "Stop"

function Normalize-Header([string]$s) {
  if ($null -eq $s) { return "" }
  return (($s.ToLower()) -replace '[^a-z0-9]+','')
}

function Canonical-Name([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return "" }
  $x = $s.ToUpper()
  $x = $x -replace '[\.,]',' '
  $x = $x -replace '\s+',' '
  $x = $x.Trim()
  $x = $x -replace '\bL L C\b','LLC'
  $x = $x -replace '\bINCORPORATED\b','INC'
  $x = $x -replace '\bCORPORATION\b','CORP'
  $x = $x -replace '\s+(LLC|INC|CORP|CO|LTD)\s*$',' $1'
  return $x.Trim()
}

function Sql-Value($v) {
  if ($null -eq $v) { return "NULL" }
  $s = [string]$v
  $s = $s.Replace("'","''")
  return "'" + $s + "'"
}

function Find-Column($HeaderMap, [string[]]$Aliases) {
  foreach ($a in $Aliases) {
    if ($HeaderMap.ContainsKey($a)) { return $HeaderMap[$a] }
  }
  return $null
}

$csvPath = Resolve-Path $CsvFile
Write-Host "Reading Arizona ROC roster:" $csvPath -ForegroundColor Green

# AZ ROC posting-list CSVs include one or more title/metadata lines before the real CSV header.
# Read the file as text, locate the actual header row, then parse from that row onward.
$rawLines = Get-Content -Path $csvPath -Encoding UTF8
if (-not $rawLines -or $rawLines.Count -eq 0) {
  throw "CSV is empty or could not be read."
}

$headerIndex = -1
$scanMax = [Math]::Min(25, $rawLines.Count)

for ($i = 0; $i -lt $scanMax; $i++) {
  $line = [string]$rawLines[$i]
  $n = (Normalize-Header $line)

  # The real header contains both a license field and a business/company/name field.
  if (($n -match 'license') -and ($n -match 'business|company|name')) {
    $headerIndex = $i
    break
  }
}

if ($headerIndex -lt 0) {
  $preview = ($rawLines | Select-Object -First 10) -join "`n"
  throw "Could not locate the ROC CSV header row. First lines found:`n$preview"
}

Write-Host ("Detected ROC header row at line {0}." -f ($headerIndex + 1)) -ForegroundColor Cyan

$csvLines = $rawLines[$headerIndex..($rawLines.Count - 1)]
$rows = $csvLines | ConvertFrom-Csv

if (-not $rows -or $rows.Count -eq 0) {
  throw "The ROC header was found, but no contractor rows could be parsed."
}

$headers = @{}
foreach ($p in $rows[0].PSObject.Properties.Name) {
  $headers[(Normalize-Header $p)] = $p
}

$aliases = @{
  license_no       = @('licenseno','licensenumber','license','roclicense','rocno','rocnumber')
  business_name    = @('businessname','business','companyname','company','licenseename','name')
  dba              = @('doingbusinessas','dba')
  class_code       = @('class','classcode','classification')
  class_detail     = @('classdetail','classificationdetail')
  class_type       = @('classtype','classificationtype')
  address          = @('address','businessaddress')
  city             = @('city')
  state            = @('state')
  zip              = @('zip','zipcode','postalcode')
  qualifying_party = @('qualifyingparty','qp')
  issued_date      = @('issueddate','issued')
  expiration_date  = @('expirationdate','expires','expiration')
  status           = @('status','licensestatus')
}

$cols = @{}
foreach ($key in $aliases.Keys) {
  $cols[$key] = Find-Column $headers $aliases[$key]
}

if (-not $cols['license_no']) {
  throw "ROC header row was detected, but the license-number column name is unfamiliar. Headers found: $($rows[0].PSObject.Properties.Name -join ', ')"
}
if (-not $cols['business_name']) {
  throw "ROC header row was detected, but the business-name column name is unfamiliar. Headers found: $($rows[0].PSObject.Properties.Name -join ', ')"
}

Write-Host ("License column: " + $cols['license_no']) -ForegroundColor DarkGray
Write-Host ("Business column: " + $cols['business_name']) -ForegroundColor DarkGray

if ([string]::IsNullOrWhiteSpace($AsOf)) {
  if ([System.IO.Path]::GetFileName($csvPath) -match '(20\d{2}-\d{2}-\d{2})') {
    $AsOf = $Matches[1]
  } else {
    $AsOf = (Get-Date).ToString('yyyy-MM-dd')
  }
}

$batch = "AZROC-$AsOf-" + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$sqlDir = Join-Path (Get-Location) "roc_sql"

if (Test-Path $sqlDir) {
  Remove-Item $sqlDir -Recurse -Force
}
New-Item -ItemType Directory -Path $sqlDir | Out-Null

$columns = "license_no,business_name,dba,class_code,class_detail,class_type,address,city,state,zip,qualifying_party,issued_date,expiration_date,status,canonical_name,canonical_dba,import_batch,source_as_of"

function Get-Field($row, $key) {
  $col = $cols[$key]
  if (-not $col) { return "" }
  $v = $row.$col
  if ($null -eq $v) { return "" }
  return ([string]$v).Trim()
}

$validRows = New-Object System.Collections.Generic.List[object]

foreach ($r in $rows) {
  $license = Get-Field $r 'license_no'
  $name = Get-Field $r 'business_name'
  if ([string]::IsNullOrWhiteSpace($license) -or [string]::IsNullOrWhiteSpace($name)) {
    continue
  }

  $dba = Get-Field $r 'dba'

  $vals = @(
    $license,
    $name,
    $dba,
    (Get-Field $r 'class_code'),
    (Get-Field $r 'class_detail'),
    (Get-Field $r 'class_type'),
    (Get-Field $r 'address'),
    (Get-Field $r 'city'),
    (Get-Field $r 'state'),
    (Get-Field $r 'zip'),
    (Get-Field $r 'qualifying_party'),
    (Get-Field $r 'issued_date'),
    (Get-Field $r 'expiration_date'),
    (Get-Field $r 'status'),
    (Canonical-Name $name),
    (Canonical-Name $dba),
    $batch,
    $AsOf
  )

  $validRows.Add($vals)
}

if ($validRows.Count -eq 0) {
  throw "No usable ROC rows were found."
}

Write-Host ("Parsed {0:N0} ROC license rows." -f $validRows.Count) -ForegroundColor Green
Write-Host "Batch:" $batch
Write-Host "Source date:" $AsOf

$chunkFiles = New-Object System.Collections.Generic.List[string]
$chunkNumber = 1

for ($start = 0; $start -lt $validRows.Count; $start += $BatchSize) {
  $end = [Math]::Min($start + $BatchSize, $validRows.Count)
  $sb = New-Object System.Text.StringBuilder

  [void]$sb.AppendLine("-- AZ ROC $batch chunk $chunkNumber")
  [void]$sb.AppendLine("INSERT OR REPLACE INTO roc_licenses ($columns) VALUES")

  for ($i = $start; $i -lt $end; $i++) {
    $rowVals = $validRows[$i]
    $sqlVals = @()
    foreach ($v in $rowVals) {
      $sqlVals += (Sql-Value $v)
    }

    $suffix = if ($i -eq ($end - 1)) { ";" } else { "," }
    [void]$sb.AppendLine("(" + ($sqlVals -join ",") + ")" + $suffix)
  }

  $fileName = ("{0:D3}.sql" -f $chunkNumber)
  $filePath = Join-Path $sqlDir $fileName
  [System.IO.File]::WriteAllText($filePath, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
  $chunkFiles.Add($filePath)
  $chunkNumber++
}

$sourceName = [System.IO.Path]::GetFileName($csvPath)
$activate = @"
-- Activate only after every chunk has imported successfully.
UPDATE roc_import_meta
SET active_batch=$(Sql-Value $batch),
    source_as_of=$(Sql-Value $AsOf),
    record_count=$($validRows.Count),
    source_file=$(Sql-Value $sourceName),
    imported_at=datetime('now')
WHERE id=1;

DELETE FROM roc_licenses
WHERE import_batch <> $(Sql-Value $batch);
"@

$activatePath = Join-Path (Get-Location) "roc_activate.sql"
[System.IO.File]::WriteAllText($activatePath, $activate, [System.Text.UTF8Encoding]::new($false))

Write-Host ("Generated {0} SQL chunks." -f $chunkFiles.Count) -ForegroundColor Green
Write-Host ""
Write-Host "Importing chunks into Cloudflare D1..." -ForegroundColor Green

foreach ($file in $chunkFiles) {
  Write-Host ("Importing " + [System.IO.Path]::GetFileName($file))
  & npx wrangler d1 execute signalhound --remote --file="$file"
  if ($LASTEXITCODE -ne 0) {
    throw "ROC import failed at $file. The active ROC roster was NOT changed."
  }
}

Write-Host ""
Write-Host "All chunks succeeded. Activating the new ROC roster..." -ForegroundColor Green
& npx wrangler d1 execute signalhound --remote --file="$activatePath"

if ($LASTEXITCODE -ne 0) {
  throw "ROC activation failed. The previous active roster remains authoritative."
}

Write-Host ""
Write-Host "Arizona ROC roster imported and activated successfully." -ForegroundColor Green
Write-Host ("Active batch: " + $batch)
Write-Host ("Records: {0:N0}" -f $validRows.Count)
Write-Host ("Source date: " + $AsOf)
Write-Host ""
Write-Host "Verify here:" -ForegroundColor Cyan
Write-Host "https://api.revenuetrigger.ai/api/health"
