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

            $lines = @{}
            $detPath = Join-Path $year.FullName $src.Det
            if (Test-Path $detPath) {
                foreach ($d in Read-Dbf $detPath @('TRNNO', 'TRNDATE', 'ITEMCODE', 'ITEMDESC', 'PCS', 'GROSSQTY', 'AMOUNT', 'SMAN')) {
                    if ($d.TRNDATE -lt $fromKey) { continue }
                    if (-not $lines.ContainsKey($d.TRNNO)) { $lines[$d.TRNNO] = New-Object System.Collections.Generic.List[object] }
                    $lines[$d.TRNNO].Add($d)
                }
            }

            foreach ($r in Read-Dbf $headPath @('TRNNO', 'TRNDATE', 'SYS_TIME', 'SMAN', 'NETAMT', 'CURR')) {
                if (-not $r.TRNDATE -or $r.TRNDATE -lt $fromKey) { continue }
                $det = if ($lines.ContainsKey($r.TRNNO)) { $lines[$r.TRNNO] } else { @() }
                $sman = $r.SMAN
                if (-not $sman) { $sman = ($det | Where-Object { $_.SMAN } | Select-Object -First 1).SMAN }
                $items = @($det | ForEach-Object {
                    @{
                        code           = $_.ITEMCODE
                        desc           = $_.ITEMDESC -replace '\s+', ' '
                        pcs            = if ($_.PCS) { [math]::Abs([decimal]$_.PCS) } else { 0 }
                        grams          = if ($_.GROSSQTY) { [math]::Abs([decimal]$_.GROSSQTY) } else { 0 }
                        amount_dirhams = $src.Sign * (To-Dirhams $_.AMOUNT)
                    }
                })
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
                })
            }
        }
    }
    @{ salesmen = @($salesmen.Values); invoices = $invoices.ToArray() }
}

# Only one run at a time (a slow full backfill must not overlap the 5-minute task).
$mutex = New-Object Threading.Mutex($false, 'Global\AmarsoftSalesSync')
if (-not $mutex.WaitOne(0)) { Log 'Previous run still going; skipping.'; return }
try {
    if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 2MB) { Move-Item $LogFile "$LogFile.old" -Force }

    $key = (Get-Content (Join-Path $Home_ 'sync.key') -Raw).Trim()
    $from = if ($Full) { [datetime]'2000-01-01' } else { (Get-Date).Date.AddDays(-$Days) }
    $fromKey = $from.ToString('yyyyMMdd')

    foreach ($branch in Get-ChildItem $Root -Directory | Where-Object Name -match '^\d{2}$' | Sort-Object Name) {
        try {
            $t = [Diagnostics.Stopwatch]::StartNew()
            $data = Read-Branch $branch $fromKey
            $payload = @{
                window_from      = $from.ToString('yyyy-MM-dd')
                branches_scanned = @($branch.Name)
                salesmen         = $data.salesmen
                invoices         = $data.invoices
            }
            $json = ConvertTo-Json -InputObject $payload -Depth 6 -Compress
            if ($DryRun) {
                $out = Join-Path $Home_ "payload-$($branch.Name).json"
                [IO.File]::WriteAllText($out, $json, [Text.Encoding]::UTF8)
                Log "Branch $($branch.Name): $($data.invoices.Count) invoices, $($data.salesmen.Count) salesmen (dry run -> $out)"
                continue
            }
            $res = Invoke-RestMethod -Uri $Endpoint -Method Post -TimeoutSec 120 `
                -Headers @{ 'x-sync-key' = $key } -ContentType 'application/json; charset=utf-8' `
                -Body ([Text.Encoding]::UTF8.GetBytes($json))
            Log ("Branch {0}: sent {1}, changed {2}, marked deleted {3}, salesmen changed {4} ({5:n1}s)" -f `
                $branch.Name, $res.invoices, $res.upserted, $res.marked_deleted, $res.salesmen, $t.Elapsed.TotalSeconds)
        } catch {
            Log "Branch $($branch.Name): FAILED - $($_.Exception.Message)"
        }
    }
} finally { $mutex.ReleaseMutex() }
