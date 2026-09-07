$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$targetRoot = [IO.Path]::GetFullPath('C:\Users\qq121\Desktop\AfterHours')
if ($sourceRoot -ne 'C:\Users\qq121\Desktop\POKER\native-stage' -or $targetRoot -ne 'C:\Users\qq121\Desktop\AfterHours') { throw 'Unexpected deployment path' }
if (Test-Path -LiteralPath $targetRoot) { throw 'Destination exists; inspect it before updating' }
New-Item -ItemType Directory -Path $targetRoot | Out-Null
foreach ($name in @('native','runtime','src','tests','assets','music','AfterHours.exe','AfterHours.exe.config','README.md','package.json')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $targetRoot -Recurse
}
$saveRoot = Join-Path $targetRoot '.poker-data'
New-Item -ItemType Directory -Path $saveRoot | Out-Null
foreach ($name in @('state.json','world.json')) {
    $legacySave = Join-Path 'C:\Users\qq121\Desktop\POKER\.poker-data' $name
    if (Test-Path -LiteralPath $legacySave) { Copy-Item -LiteralPath $legacySave -Destination $saveRoot }
}
$logsName = [string]([char]0x65E5)+[char]0x5FD7
New-Item -ItemType Directory -Path (Join-Path $targetRoot $logsName) | Out-Null
$legacyLogs = Join-Path 'C:\Users\qq121\Desktop\POKER' $logsName
Get-ChildItem -LiteralPath $legacyLogs -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $targetRoot $logsName) }
$proofRoot = Join-Path $targetRoot 'verification'
New-Item -ItemType Directory -Path $proofRoot | Out-Null
Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'qa') -File | Where-Object { $_.Extension -eq '.png' -or $_.Name -in @('result.json','rules-tests.txt') } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $proofRoot }
$manifest = Get-ChildItem -LiteralPath $targetRoot -Recurse -File | Where-Object { $_.FullName -notlike '*\.poker-data\*' } | ForEach-Object {
    [pscustomobject]@{ Path=$_.FullName.Substring($targetRoot.Length+1); Bytes=$_.Length; SHA256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $proofRoot 'files.json') -Encoding UTF8
Write-Output ('Created native game: ' + (Join-Path $targetRoot 'AfterHours.exe'))
Write-Output ('Files: ' + $manifest.Count)
