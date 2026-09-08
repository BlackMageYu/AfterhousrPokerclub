param(
  [string]$AtlasPath = (Join-Path $PSScriptRoot "..\assets\cards\atlas-hd.png"),
  [string]$BackPath = (Join-Path $PSScriptRoot "..\assets\cards\card-back-source.png"),
  [string]$OutputPath = (Join-Path $PSScriptRoot "..\assets\cards\faces")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$grid = @(
  "BACK,8s,5s,Qs,8h,3h,Th,6c,Kc,9d,8d",
  "9s,6s,Ks,9h,4h,Jh,7c,2c,Ac,4d,3d",
  "7s,2s,As,5h,Qh,8c,3c,Tc,5d,Qd,Jd",
  "4s,Js,7h,2h,Ah,5c,Qc,7d,2d,Td,Ad",
  "3s,Ts,6h,Kh,9c,4c,Jc,6d,Kd"
)
$suits = @{
  s = ([string][char]0x9ED1) + ([string][char]0x6843)
  h = ([string][char]0x7EA2) + ([string][char]0x6843)
  c = ([string][char]0x8349) + ([string][char]0x82B1)
  d = ([string][char]0x65B9) + ([string][char]0x7247)
}
$faces = @($grid | ForEach-Object { $_.Split(',') } | Where-Object { $_ -ne "BACK" })
if ($faces.Count -ne 52 -or @($faces | Select-Object -Unique).Count -ne 52) {
  throw "The card map must contain exactly 52 distinct faces."
}
if (-not (Test-Path -LiteralPath $AtlasPath) -or -not (Test-Path -LiteralPath $BackPath)) {
  throw "The source atlas or card-back image is missing."
}

New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
$atlas = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $AtlasPath))
$back = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $BackPath))

function Save-Png([System.Drawing.Image]$source, [System.Drawing.Rectangle]$sourceRect, [string]$destination) {
  $targetWidth = 640
  $targetHeight = [int][Math]::Round($sourceRect.Height * $targetWidth / $sourceRect.Width)
  $target = New-Object System.Drawing.Bitmap $targetWidth, $targetHeight, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($target)
  try {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.DrawImage($source, (New-Object System.Drawing.Rectangle 0, 0, $targetWidth, $targetHeight), $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
    $target.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $target.Dispose()
  }
}

try {
  # The atlas has 11 equal columns and 5 equal rows. The three-pixel trim
  # removes only the black grid gutter around each card.
  for ($row = 0; $row -lt $grid.Count; $row++) {
    $rowCards = $grid[$row].Split(',')
    for ($column = 0; $column -lt $rowCards.Count; $column++) {
      $card = $rowCards[$column]
      if ($card -eq "BACK") { continue }
      $left = [int][Math]::Round($column * $atlas.Width / 11)
      $right = [int][Math]::Round(($column + 1) * $atlas.Width / 11)
      $top = [int][Math]::Round($row * $atlas.Height / 5)
      $bottom = [int][Math]::Round(($row + 1) * $atlas.Height / 5)
      $trim = 3
      $rect = New-Object System.Drawing.Rectangle ($left + $trim), ($top + $trim), ($right - $left - $trim * 2), ($bottom - $top - $trim * 2)
      if ($rect.Width -le 0 -or $rect.Height -le 0) { throw "Unable to divide the atlas grid." }
      $rank = if ($card[0] -eq 'T') { '10' } else { $card.Substring(0, 1) }
      $suitKey = [string]$card[1]
      $filename = "{0}_{1}.png" -f $suits[$suitKey], $rank
      Save-Png $atlas $rect (Join-Path $OutputPath $filename)
    }
  }

  $backRect = New-Object System.Drawing.Rectangle 0, 0, $back.Width, $back.Height
  Save-Png $back $backRect (Join-Path (Split-Path $OutputPath -Parent) "card-back.png")
  $written = @(Get-ChildItem -LiteralPath $OutputPath -Filter '*.png' -File)
  if ($written.Count -ne 52) { throw "Unexpected exported-card count: $($written.Count)." }
  Write-Output "Exported 52 card faces and one card back."
} finally {
  $atlas.Dispose()
  $back.Dispose()
}
