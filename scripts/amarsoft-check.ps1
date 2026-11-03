# Read-only check: run on a shop PC that has Amarsoft, then send back amarsoft-check.txt.
# It only lists folders, file names and services. It changes nothing.
$out = Join-Path $env:USERPROFILE 'Desktop\amarsoft-check.txt'
& {
  "== Installed programs matching Amar / SQL =="
  Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                   'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'amar|عمار|sql|firebird|access' } |
    Select-Object DisplayName, DisplayVersion, InstallLocation | Format-Table -AutoSize | Out-String -Width 300

  "== Database services =="
  Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'SQL|MSSQL|firebird|mysql|postgres' } |
    Select-Object Name, Status, DisplayName | Format-Table -AutoSize | Out-String -Width 300

  "== Amarsoft folders =="
  $roots = 'C:\', 'D:\', 'C:\Program Files', 'C:\Program Files (x86)'
  $dirs = foreach ($r in $roots) { Get-ChildItem $r -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'amar|عمار' } }
  $dirs | Select-Object -ExpandProperty FullName

  "== Database files inside those folders =="
  foreach ($d in $dirs) {
    Get-ChildItem $d.FullName -Recurse -File -ErrorAction SilentlyContinue -Include *.mdf,*.ldf,*.mdb,*.accdb,*.fdb,*.gdb,*.db,*.sqlite,*.ini,*.config,*.udl |
      Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize | Out-String -Width 400
  }
} *> $out
"Saved: $out"
