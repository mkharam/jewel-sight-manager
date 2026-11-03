<#
  Amarsoft -> Jewel Sight Manager sales sync.

  Reads retail sales (trn_rtsal/trn_rtsaldet), returns (trn_rtsrt/trn_rtsrtdet) and the
  salesman list (mst_sman, shown in Amarsoft as "Carriers" / الناقلين) from every branch
  under M:\AMARSOFT\<branch>\<year>\ and posts them to the amarsoft-sync edge function,
  one request per branch.

  Read-only: the .dbf files are opened with Read access and full sharing, so Amarsoft
  keeps working and nothing is ever written to it.

  Each run resends the last -Days days, so missed runs (no internet, power cut) heal on
  the next one, and edits (e.g. a salesman added later) and deletions are picked up.
  -Full sends everything (first-time backfill). -DryRun writes the payloads to disk only.

  Runs every 5 minutes from the "Amarsoft Sales Sync" scheduled task.
#>
param(
    [string]$Root = 'M:\AMARSOFT',
    [int]$Days = 40,
    [switch]$Full,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Home_ = Split-Path -Parent $MyInvocation.MyCommand.Path
$Endpoint = 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/amarsoft-sync'
$LogFile = Join-Path $Home_ 'sync.log'
$arabic = [Text.Encoding]::GetEncoding(1256)

function Log([string]$msg) {
    $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg
    Write-Output $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Read-Dbf([string]$Path, [string[]]$Want) {
    $fs = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try {
        $br = New-Object IO.BinaryReader($fs)
        $head = $br.ReadBytes(32)
        $count = [BitConverter]::ToUInt32($head, 4)
        $headLen = [BitConverter]::ToUInt16($head, 8)
        $recLen = [BitConverter]::ToUInt16($head, 10)
        $fields = @(); $offset = 1
        while ($true) {
            $d = $br.ReadBytes(32)
            if ($d.Length -lt 32 -or $d[0] -eq 0x0D) { break }
            $name = [Text.Encoding]::ASCII.GetString($d, 0, 11).Trim([char]0)
            if ($Want -contains $name) { $fields += [pscustomobject]@{ Name = $name; Offset = $offset; Len = $d[16] } }
            $offset += $d[16]
        }
        $fs.Position = $headLen
        for ($i = 0; $i -lt $count; $i++) {
            $rec = $br.ReadBytes($recLen)
            if ($rec.Length -lt $recLen) { break }   # file grew/shrank while reading
            if ($rec[0] -eq 0x2A) { continue }       # deleted in Amarsoft
            $row = @{}
            foreach ($f in $fields) { $row[$f.Name] = $arabic.GetString($rec, $f.Offset, $f.Len).Trim() }
            $row
        }
    } finally { $fs.Close() }
}

function To-Dirhams([string]$amount) {
    if (-not $amount) { return [long]0 }
    [long][math]::Round([math]::Abs([decimal]$amount) * 1000)
}

function To-Num([string]$value) {
    if (-not $value) { return 0 }
    [math]::Abs([decimal]$value)
}

# Customer names live in the guest list (ملف الضيوف); invoices only carry GUSCODE.
function Read-Guests([string]$yearPath) {
    $guests = @{}
    $path = Join-Path $yearPath 'guest.DBF'
    if (Test-Path $path) { foreach ($g in Read-Dbf $path @('GUSCODE', 'GUSDESCP', 'TEL1')) { $guests[$g.GUSCODE] = $g } }
    $guests
}

function Read-Branch($branch, [string]$fromKey) {
    $salesmen = @{}
    $invoices = New-Object System.Collections.Generic.List[object]
    foreach ($year in Get-ChildItem $branch.FullName -Directory | Where-Object Name -match '^\d{4}$' | Sort-Object Name) {
        $smanFile = Join-Path $year.FullName 'mst_sman.dbf'
        if (Test-Path $smanFile) {
            foreach ($s in Read-Dbf $smanFile @('SMAN', 'SMANNAME', 'ISACTIVE')) {
                if ($s.SMAN) { $salesmen[$s.SMAN] = @{ branch = $branch.Name; sman = $s.SMAN; name = $s.SMANNAME; active = ($s.ISACTIVE -ne 'F') } }
            }
        }

        foreach ($src in @(@{ Head = 'trn_rtsal.dbf'; Det = 'trn_rtsaldet.dbf'; Kind = 'sale'; Sign = 1 },
                           @{ Head = 'trn_rtsrt.dbf'; Det = 'trn_rtsrtdet.dbf'; Kind = 'return'; Sign = -1 })) {
            $headPath = Join-Path $year.FullName $src.Head
            if (-not (Test-Path $headPath)) { continue }

            $guests = Read-Guests $year.FullName
            $lines = @{}
            $detPath = Join-Path $year.FullName $src.Det
            if (Test-Path $detPath) {
                foreach ($d in Read-Dbf $detPath @('TRNNO', 'TRNDATE', 'ITEMCODE', 'ITEMSUB', 'ITEMDESC', 'PCS', 'GROSSQTY', 'PUREQTY',
                                                   'PURITY', 'MD_RATEFC', 'MD_AMT', 'MTL_RATEFC', 'MTL_AMT', 'RATEFC', 'AMOUNT',
                                                   'DISCAMT', 'VATPER', 'VATAMT', 'SMAN')) {
                    if ($d.TRNDATE -lt $fromKey) { continue }
                    if (-not $lines.ContainsKey($d.TRNNO)) { $lines[$d.TRNNO] = New-Object System.Collections.Generic.List[object] }
                    $lines[$d.TRNNO].Add($d)
                }
            }

            $headCols = 'TRNNO', 'TRNDATE', 'SYS_DATE', 'SYS_TIME', 'SMAN', 'NETAMT', 'CURR', 'CUSTOMER', 'PHONENO', 'TEL1',
                        'GUSCODE', 'EIDNO', 'REFNO', 'REF', 'RATE', 'SRATE', 'GROSSQTY', 'PUREQTY', 'MD_AMT', 'MTL_AMT',
                        'GROSSAMT', 'DISC', 'VATAMT', 'LPRINTED',
                        'PARTYACC', 'PAIDAMT', 'PARTYACC2', 'PAIDAMT2', 'PARTYCODE3', 'PAIDAMT3',
                        'PARTYCODE4', 'PAIDAMT4', 'PARTYCODE5', 'PAIDAMT5'
            foreach ($r in Read-Dbf $headPath $headCols) {
                if (-not $r.TRNDATE -or $r.TRNDATE -lt $fromKey) { continue }
                $det = if ($lines.ContainsKey($r.TRNNO)) { $lines[$r.TRNNO] } else { @() }
                $sman = $r.SMAN
                if (-not $sman) { $sman = ($det | Where-Object { $_.SMAN } | Select-Object -First 1).SMAN }
                $items = @($det | ForEach-Object {
                    @{
                        code            = $_.ITEMCODE
                        tag             = $_.ITEMSUB
                        desc            = $_.ITEMDESC -replace '\s+', ' '
                        pcs             = To-Num $_.PCS
                        grams           = To-Num $_.GROSSQTY
                        pure_grams      = To-Num $_.PUREQTY
                        purity          = To-Num $_.PURITY
                        gold_rate       = To-Num $_.MTL_RATEFC
                        making_rate     = To-Num $_.MD_RATEFC
                        rate_per_gram   = To-Num $_.RATEFC
                        metal_dirhams   = To-Dirhams $_.MTL_AMT
                        making_dirhams  = To-Dirhams $_.MD_AMT
                        discount_dirhams = To-Dirhams $_.DISCAMT
                        vat_percent     = To-Num $_.VATPER
                        vat_dirhams     = To-Dirhams $_.VATAMT
                        sman            = $_.SMAN
                        amount_dirhams  = $src.Sign * (To-Dirhams $_.AMOUNT)
                    }
                })
                $guest = if ($r.GUSCODE -and $guests.ContainsKey($r.GUSCODE)) { $guests[$r.GUSCODE] } else { $null }
                $payments = @(@(@($r.PARTYACC, $r.PAIDAMT), @($r.PARTYACC2, $r.PAIDAMT2), @($r.PARTYCODE3, $r.PAIDAMT3),
                                @($r.PARTYCODE4, $r.PAIDAMT4), @($r.PARTYCODE5, $r.PAIDAMT5)) |
                    Where-Object { $_[0] -and (To-Dirhams $_[1]) -gt 0 } |
                    ForEach-Object { @{ account = $_[0]; amount_dirhams = To-Dirhams $_[1] } })
                $details = @{
                    customer         = if ($r.CUSTOMER) { $r.CUSTOMER } elseif ($guest) { $guest.GUSDESCP } else { $null }
                    phone            = if ($r.PHONENO) { $r.PHONENO } elseif ($r.TEL1) { $r.TEL1 } elseif ($guest) { $guest.TEL1 } else { $null }
                    guest_code       = $r.GUSCODE
                    id_no            = $r.EIDNO
                    ref_no           = if ($r.REFNO) { $r.REFNO } else { $r.REF }
                    gold_rate        = To-Num $r.RATE
                    silver_rate      = To-Num $r.SRATE
                    grams            = To-Num $r.GROSSQTY
                    pure_grams       = To-Num $r.PUREQTY
                    metal_dirhams    = To-Dirhams $r.MTL_AMT
                    making_dirhams   = To-Dirhams $r.MD_AMT
                    gross_dirhams    = To-Dirhams $r.GROSSAMT
                    discount_dirhams = To-Dirhams $r.DISC
                    vat_dirhams      = To-Dirhams $r.VATAMT
                    payments         = $payments
                    printed          = ($r.LPRINTED -eq 'T')
                    entered          = if ($r.SYS_DATE) { $r.SYS_DATE.Insert(6, '-').Insert(4, '-') + ' ' + $r.SYS_TIME } else { $null }
                }
                $invoices.Add(@{
                    branch      = $branch.Name
                    year        = $year.Name
                    kind        = $src.Kind
                    no          = $r.TRNNO
                    date        = $r.TRNDATE.Insert(6, '-').Insert(4, '-')
                    time        = $r.SYS_TIME
                    sman        = $sman
                    currency    = $r.CURR
                    net_dirhams = $src.Sign * (To-Dirhams $r.NETAMT)
                    items       = $items
                    details     = $details
                })
            }
        }
    }
    @{ salesmen = @($salesmen.Values); invoices = $invoices.ToArray() }
}

function To-Date([string]$yyyymmdd) {
    if ($yyyymmdd -match '^\d{8}$') { $yyyymmdd.Insert(6, '-').Insert(4, '-') } else { $null }
}

# Tagged-piece stock (stk4wd) and the customer list (guest) from the branch's current year folder.
# $sinceKey limits stock to pieces received or sold since then; '' sends every piece.
function Read-Master($branch, [string]$sinceKey) {
    $year = Get-ChildItem $branch.FullName -Directory | Where-Object Name -match '^\d{4}$' | Sort-Object Name | Select-Object -Last 1
    $types = @{}; $suppliers = @{}
    $typeFile = Join-Path $year.FullName 'mst_type.dbf'
    if (Test-Path $typeFile) { foreach ($t in Read-Dbf $typeFile @('TYPE', 'DESC')) { $types[$t.TYPE] = ($t.DESC -replace '\s+', ' ').Trim() } }
    $accFile = Join-Path $year.FullName 'act4w.DBF'
    if (Test-Path $accFile) { foreach ($a in Read-Dbf $accFile @('ACCODE', 'ACCDESC')) { $suppliers[$a.ACCODE] = $a.ACCDESC } }

    $stock = New-Object System.Collections.Generic.List[object]
    $stkFile = Join-Path $year.FullName 'stk4wd.dbf'
    if (Test-Path $stkFile) {
        foreach ($s in Read-Dbf $stkFile @('ITEMCODE', 'ITEMSUB', 'CARAT', 'TYPE', 'SUPPCODE', 'M_LAST', 'SALPR1', 'LASTPDATE',
                                           'LASTSDATE', 'GRTINQTY', 'PUTINQTY', 'GRCLSQTY', 'PUCLSQTY', 'M_TINVAL', 'SPURITY')) {
            if ($s.ITEMSUB -notmatch '^\d{6,}$') { continue }   # only labelled pieces, not bulk gold
            if ($sinceKey -and $s.LASTPDATE -lt $sinceKey -and $s.LASTSDATE -lt $sinceKey) { continue }
            $grams = if ($s.GRCLSQTY) { [decimal]$s.GRCLSQTY } else { 0 }
            $stock.Add(@{
                tag              = $s.ITEMSUB
                item_code        = $s.ITEMCODE
                type_code        = $s.TYPE
                type_name        = $types[$s.TYPE]
                karat            = $s.CARAT
                purity           = To-Num $s.SPURITY
                grams_in         = To-Num $s.GRTINQTY
                pure_grams_in    = To-Num $s.PUTINQTY
                grams            = [math]::Max([decimal]0, $grams)
                pure_grams       = if ($grams -gt 0) { To-Num $s.PUCLSQTY } else { 0 }
                in_stock         = ($grams -gt 0)
                making_cost_rate = To-Num $s.M_LAST
                making_sale_rate = To-Num $s.SALPR1
                cost_dirhams     = To-Dirhams $s.M_TINVAL
                supplier_code    = $s.SUPPCODE
                supplier_name    = $suppliers[$s.SUPPCODE]
                received_on      = To-Date $s.LASTPDATE
                sold_on          = To-Date $s.LASTSDATE
            })
        }
    }

    $customers = New-Object System.Collections.Generic.List[object]
    $guestFile = Join-Path $year.FullName 'guest.DBF'
    if (Test-Path $guestFile) {
        foreach ($g in Read-Dbf $guestFile @('GUSCODE', 'GUSDESCP', 'PHONENO', 'TEL1', 'TEL2', 'CITY', 'AREA', 'ADDR1', 'DOB',
                                             'GENDER', 'OPENDATE', 'L_SALNO', 'L_SALDATE', 'L_SALVAL', 'T_SALVAL', 'EIDNO', 'NATION')) {
            if (-not $g.GUSCODE) { continue }
            $phone = @($g.PHONENO, $g.TEL1, $g.TEL2) | Where-Object { $_ } | Select-Object -First 1
            $customers.Add(@{
                code  = $g.GUSCODE
                name  = ($g.GUSDESCP -replace '\s+', ' ')
                phone = $phone
                data  = @{
                    phones          = @(@($g.PHONENO, $g.TEL1, $g.TEL2) | Where-Object { $_ } | Select-Object -Unique)
                    city            = $g.CITY
                    area            = $g.AREA
                    address         = $g.ADDR1
                    dob             = To-Date $g.DOB
                    gender          = $g.GENDER
                    id_no           = $g.EIDNO
                    nation          = $g.NATION
                    opened          = To-Date $g.OPENDATE
                    last_sale_no    = $g.L_SALNO
                    last_sale_on    = To-Date $g.L_SALDATE
                    last_sale_dirhams  = To-Dirhams $g.L_SALVAL
                    total_sales_dirhams = To-Dirhams $g.T_SALVAL
                }
            })
        }
    }
    @{ stock = $stock.ToArray(); customers = $customers.ToArray() }
}

function Send([hashtable]$payload, [string]$name) {
    $json = ConvertTo-Json -InputObject $payload -Depth 6 -Compress
    if ($DryRun) {
        $out = Join-Path $Home_ "payload-$name.json"
        [IO.File]::WriteAllText($out, $json, [Text.Encoding]::UTF8)
        return @{ dry_run = $out }
    }
    Invoke-RestMethod -Uri $Endpoint -Method Post -TimeoutSec 120 `
        -Headers @{ 'x-sync-key' = $key } -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($json))
}

# Only one run at a time (a slow full backfill must not overlap the 5-minute task).
$mutex = New-Object Threading.Mutex($false, 'Global\AmarsoftSalesSync')
if (-not $mutex.WaitOne(0)) { Log 'Previous run still going; skipping.'; return }
try {
    if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 2MB) { Move-Item $LogFile "$LogFile.old" -Force }

    $key = (Get-Content (Join-Path $Home_ 'sync.key') -Raw).Trim()
    $from = if ($Full) { [datetime]'2000-01-01' } else { (Get-Date).Date.AddDays(-$Days) }
    $fromKey = $from.ToString('yyyyMMdd')

    # Full stock list once an hour (catches weight edits and removed tags); otherwise only pieces
    # received or sold in the last 3 days.
    $stateFile = Join-Path $Home_ 'last-full-stock.txt'
    $lastFull = if (Test-Path $stateFile) { [datetime](Get-Content $stateFile -Raw).Trim() } else { [datetime]::MinValue }
    $fullStock = $Full -or ((Get-Date) - $lastFull).TotalMinutes -ge 60
    $sinceKey = if ($fullStock) { '' } else { (Get-Date).Date.AddDays(-3).ToString('yyyyMMdd') }
    $stockOk = $true

    foreach ($branch in Get-ChildItem $Root -Directory | Where-Object Name -match '^\d{2}$' | Sort-Object Name) {
        try {
            $t = [Diagnostics.Stopwatch]::StartNew()
            $data = Read-Branch $branch $fromKey
            $res = Send @{
                window_from      = $from.ToString('yyyy-MM-dd')
                branches_scanned = @($branch.Name)
                salesmen         = $data.salesmen
                invoices         = $data.invoices
            } $branch.Name
            if ($DryRun) { Log "Branch $($branch.Name): $($data.invoices.Count) invoices, $($data.salesmen.Count) salesmen (dry run -> $($res.dry_run))" }
            else {
                Log ("Branch {0}: sent {1}, changed {2}, marked deleted {3}, salesmen changed {4} ({5:n1}s)" -f `
                    $branch.Name, $res.invoices, $res.upserted, $res.marked_deleted, $res.salesmen, $t.Elapsed.TotalSeconds)
            }
        } catch {
            Log "Branch $($branch.Name): FAILED - $($_.Exception.Message)"
        }

        try {
            $t = [Diagnostics.Stopwatch]::StartNew()
            $master = Read-Master $branch $sinceKey
            $res = Send @{ kind = 'master'; branch = $branch.Name; full = $fullStock; stock = $master.stock; customers = $master.customers } "$($branch.Name)-master"
            if ($DryRun) { Log "Branch $($branch.Name): $($master.stock.Count) pieces, $($master.customers.Count) customers (dry run -> $($res.dry_run))" }
            else {
                Log ("Branch {0}: stock sent {1} ({2}), changed {3}; customers {4}, changed {5}, new {6}, matched {7} ({8:n1}s)" -f `
                    $branch.Name, $master.stock.Count, $(if ($fullStock) { 'full' } else { 'recent' }), $res.stock_changed,
                    $master.customers.Count, $res.customers_changed, $res.customers_created, $res.customers_matched, $t.Elapsed.TotalSeconds)
            }
        } catch {
            $stockOk = $false
            Log "Branch $($branch.Name) stock/customers: FAILED - $($_.Exception.Message)"
        }
    }
    if ($fullStock -and $stockOk -and -not $DryRun) { Set-Content -Path $stateFile -Value (Get-Date).ToString('o') }
} finally { $mutex.ReleaseMutex() }
