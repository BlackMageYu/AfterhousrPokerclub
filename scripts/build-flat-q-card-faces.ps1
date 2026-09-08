param(
  [string]$SourcePath = ('C:\baidunetdiskdownload\57'+([string][char]0x5957)+([string][char]0x6251)+([string][char]0x514B)+([string][char]0x724C)+'+84'+([string][char]0x5957)+([string][char]0x724C)+([string][char]0x80CC)+'\41'),
  [string]$MasterPath = (Join-Path $PSScriptRoot '..\assets\cards\style-masters'),
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\assets\cards\faces-flat-q')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$width = 768
$height = 1000
$red = [System.Drawing.Color]::FromArgb(217,0,27)       # #D9001B
$black = [System.Drawing.Color]::FromArgb(36,33,36)      # soft charcoal
$paper = [System.Drawing.Color]::FromArgb(252,251,248)
$suitNames = @{
  d = ([string][char]0x65B9) + ([string][char]0x7247)
  c = ([string][char]0x8349) + ([string][char]0x82B1)
  h = ([string][char]0x7EA2) + ([string][char]0x6843)
  s = ([string][char]0x9ED1) + ([string][char]0x6843)
}
$suits = @(
  [pscustomobject]@{ Key='d'; Hex='0'; IsRed=$true;  Master='diamond-2.png' },
  [pscustomobject]@{ Key='c'; Hex='1'; IsRed=$false; Master='club-2.png' },
  [pscustomobject]@{ Key='h'; Hex='2'; IsRed=$true;  Master='heart-2.png' },
  [pscustomobject]@{ Key='s'; Hex='3'; IsRed=$false; Master='spade-2.png' }
)
$ranks = @(
  [pscustomobject]@{ Label='2'; Code='1' }, [pscustomobject]@{ Label='3'; Code='2' },
  [pscustomobject]@{ Label='4'; Code='3' }, [pscustomobject]@{ Label='5'; Code='4' },
  [pscustomobject]@{ Label='6'; Code='5' }, [pscustomobject]@{ Label='7'; Code='6' },
  [pscustomobject]@{ Label='8'; Code='7' }, [pscustomobject]@{ Label='9'; Code='8' },
  [pscustomobject]@{ Label='10'; Code='9' }, [pscustomobject]@{ Label='J'; Code='a' },
  [pscustomobject]@{ Label='Q'; Code='b' }, [pscustomobject]@{ Label='K'; Code='c' },
  [pscustomobject]@{ Label='A'; Code='d' }
)

function New-RoundedPath([double]$x,[double]$y,[double]$w,[double]$h,[double]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = [Math]::Min($radius * 2,[Math]::Min($w,$h))
  $path.AddArc($x,$y,$diameter,$diameter,180,90)
  $path.AddArc($x+$w-$diameter,$y,$diameter,$diameter,270,90)
  $path.AddArc($x+$w-$diameter,$y+$h-$diameter,$diameter,$diameter,0,90)
  $path.AddArc($x,$y+$h-$diameter,$diameter,$diameter,90,90)
  $path.CloseFigure()
  return $path
}

function Test-PaperPixel([System.Drawing.Color]$pixel) {
  if($pixel.A -eq 0) { return $false }
  $largest=[Math]::Max($pixel.R,[Math]::Max($pixel.G,$pixel.B))
  $smallest=[Math]::Min($pixel.R,[Math]::Min($pixel.G,$pixel.B))
  return $largest -ge 175 -and ($largest-$smallest) -lt 54
}

function Clear-OutsideCard([System.Drawing.Bitmap]$bitmap) {
  # Remove only the paper connected to the canvas edge.  The enclosed paper
  # stays intact while the rounded card can rotate without a white rectangle.
  $pixelCount=$bitmap.Width*$bitmap.Height
  $seen=New-Object 'System.Boolean[]' $pixelCount
  $queue=New-Object 'System.Collections.Generic.Queue[int]'
  $seed=@()
  for($x=0;$x -lt $bitmap.Width;$x++){ $seed+=$x; $seed+=(($bitmap.Height-1)*$bitmap.Width+$x) }
  for($y=1;$y -lt $bitmap.Height-1;$y++){ $seed+=($y*$bitmap.Width); $seed+=($y*$bitmap.Width+$bitmap.Width-1) }
  foreach($index in $seed){
    if($seen[$index]){continue}
    $x=$index%$bitmap.Width;$y=[int][Math]::Floor($index/$bitmap.Width)
    if(Test-PaperPixel $bitmap.GetPixel($x,$y)){ $seen[$index]=$true;$queue.Enqueue($index) }
  }
  while($queue.Count -gt 0){
    $index=$queue.Dequeue();$x=$index%$bitmap.Width;$y=[int][Math]::Floor($index/$bitmap.Width)
    $bitmap.SetPixel($x,$y,[System.Drawing.Color]::Transparent)
    foreach($neighbor in @(
      $(if($x -gt 0){$index-1}),$(if($x -lt $bitmap.Width-1){$index+1}),
      $(if($y -gt 0){$index-$bitmap.Width}),$(if($y -lt $bitmap.Height-1){$index+$bitmap.Width})
    )){
      if($neighbor -eq $null -or $seen[$neighbor]){continue}
      $nx=$neighbor%$bitmap.Width;$ny=[int][Math]::Floor($neighbor/$bitmap.Width)
      if(Test-PaperPixel $bitmap.GetPixel($nx,$ny)){ $seen[$neighbor]=$true;$queue.Enqueue($neighbor) }
    }
  }
}

function Add-Heart([System.Drawing.Drawing2D.GraphicsPath]$path,[double]$x,[double]$y,[double]$w,[double]$h) {
  $cx=$x+$w/2
  $path.StartFigure()
  $path.AddBezier($cx,$y+$h, $x+$w*.02,$y+$h*.64, $x,$y+$h*.22, $x+$w*.25,$y+$h*.10)
  $path.AddBezier($x+$w*.25,$y+$h*.10, $x+$w*.43,$y+$h*.02, $cx,$y+$h*.20, $cx,$y+$h*.36)
  $path.AddBezier($cx,$y+$h*.36, $x+$w*.57,$y+$h*.02, $x+$w*.75,$y+$h*.10, $x+$w,$y+$h*.22)
  $path.AddBezier($x+$w,$y+$h*.22, $x+$w*.98,$y+$h*.64, $cx,$y+$h, $cx,$y+$h)
  $path.CloseFigure()
}

function Add-Diamond([System.Drawing.Drawing2D.GraphicsPath]$path,[double]$x,[double]$y,[double]$w,[double]$h) {
  $cx=$x+$w/2;$cy=$y+$h/2
  $path.StartFigure()
  $path.AddBezier($cx,$y, $x+$w*.78,$y+$h*.18, $x+$w,$cy-$h*.12, $x+$w,$cy)
  $path.AddBezier($x+$w,$cy, $x+$w*.79,$y+$h*.82, $cx,$y+$h, $cx,$y+$h)
  $path.AddBezier($cx,$y+$h, $x+$w*.21,$y+$h*.82, $x,$cy+$h*.12, $x,$cy)
  $path.AddBezier($x,$cy, $x+$w*.22,$y+$h*.18, $cx,$y, $cx,$y)
  $path.CloseFigure()
}

function Draw-Suit([System.Drawing.Graphics]$graphics,[string]$suit,[System.Drawing.Brush]$brush,[double]$x,[double]$y,[double]$w,[double]$h) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  try {
    switch($suit) {
      'd' { Add-Diamond $path $x $y $w $h; $graphics.FillPath($brush,$path) }
      'h' { Add-Heart $path $x $y $w $h; $graphics.FillPath($brush,$path) }
      's' {
        # Draw the round spade in overlapping solid layers.  Keeping the lobes
        # separate avoids a self-intersection hole in GDI+ path filling.
        $cap = New-Object System.Drawing.Drawing2D.GraphicsPath
        $points = New-Object 'System.Drawing.PointF[]' 3
        $points[0] = New-Object System.Drawing.PointF ($x+$w*.5),$y
        $points[1] = New-Object System.Drawing.PointF ($x+$w*.08),($y+$h*.64)
        $points[2] = New-Object System.Drawing.PointF ($x+$w*.92),($y+$h*.64)
        $cap.AddPolygon($points)
        $graphics.FillPath($brush,$cap)
        $cap.Dispose()
        $lobe = $w*.56
        $graphics.FillEllipse($brush,$x,$y+$h*.28,$lobe,$h*.48)
        $graphics.FillEllipse($brush,$x+$w*.44,$y+$h*.28,$lobe,$h*.48)
        $stem = New-RoundedPath ($x+$w*.37) ($y+$h*.58) ($w*.26) ($h*.32) ($w*.055)
        $graphics.FillPath($brush,$stem)
        $stem.Dispose()
      }
      'c' {
        $circle = $w*.46
        $graphics.FillEllipse($brush,$x+$w*.27,$y,$circle,$circle)
        $graphics.FillEllipse($brush,$x,$y+$h*.28,$circle,$circle)
        $graphics.FillEllipse($brush,$x+$w*.54,$y+$h*.28,$circle,$circle)
        $stem = New-RoundedPath ($x+$w*.38) ($y+$h*.53) ($w*.24) ($h*.38) ($w*.055)
        $graphics.FillPath($brush,$stem)
        $stem.Dispose()
      }
    }
  } finally { $path.Dispose() }
}

function Normalize-Master([string]$master,[System.Drawing.Color]$pipColor,[string]$destination) {
  $source = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $master))
  $bitmap = New-Object System.Drawing.Bitmap $width,$height,([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CompositingQuality=[System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source,(New-Object System.Drawing.Rectangle 0,0,$width,$height))
  } finally { $graphics.Dispose();$source.Dispose() }
  for($y=0;$y -lt $height;$y++) { for($x=0;$x -lt $width;$x++) {
    $pixel=$bitmap.GetPixel($x,$y)
    if($pixel.A -eq 0) { continue }
    if($pixel.R -gt 172 -and $pixel.G -gt 172 -and $pixel.B -gt 172) { $bitmap.SetPixel($x,$y,$paper);continue }
    $largest=[Math]::Max($pixel.R,[Math]::Max($pixel.G,$pixel.B))
    $smallest=[Math]::Min($pixel.R,[Math]::Min($pixel.G,$pixel.B))
    if($pipColor.R -gt $pipColor.B -and $pixel.R -gt 110 -and $pixel.R -gt $pixel.G*1.35 -and $pixel.R -gt $pixel.B*1.35) { $bitmap.SetPixel($x,$y,$pipColor);continue }
    if($largest -lt 170 -and $largest-$smallest -lt 42) { $bitmap.SetPixel($x,$y,$black) }
  }}
  Clear-OutsideCard $bitmap
  try { $bitmap.Save($destination,[System.Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
}

function Get-MasterFile([string]$suit) {
  switch($suit) {
    'd' { return (Join-Path $MasterPath 'diamond-2.png') }
    'c' { return (Join-Path $MasterPath 'club-2.png') }
    'h' { return (Join-Path $MasterPath 'heart-2.png') }
    's' { return (Join-Path $MasterPath 'spade-2.png') }
    default { throw "Unknown suit: $suit" }
  }
}

function Draw-MasterPip([System.Drawing.Graphics]$graphics,[string]$suit,[System.Drawing.Color]$pipColor,[double]$x,[double]$y,[double]$w,[double]$h,[bool]$small) {
  # The generated master already contains the desired friendly pip silhouette.
  # Crop only that silhouette and key out its paper background before placing it.
  $master = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath (Get-MasterFile $suit)))
  $targetWidth = [Math]::Max(1,[int][Math]::Round($w))
  $targetHeight = [Math]::Max(1,[int][Math]::Round($h))
  $sourceRectangle = if($small) {
    New-Object System.Drawing.Rectangle ([int]($master.Width*.08)),([int]($master.Height*.30)),([int]($master.Width*.27)),([int]($master.Height*.25))
  } else {
    New-Object System.Drawing.Rectangle ([int]($master.Width*.38)),([int]($master.Height*.48)),([int]($master.Width*.58)),([int]($master.Height*.44))
  }
  $pip = New-Object System.Drawing.Bitmap $targetWidth,$targetHeight,([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $pipGraphics = [System.Drawing.Graphics]::FromImage($pip)
  try {
    $pipGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $pipGraphics.DrawImage($master,(New-Object System.Drawing.Rectangle 0,0,$targetWidth,$targetHeight),$sourceRectangle,[System.Drawing.GraphicsUnit]::Pixel)
  } finally { $pipGraphics.Dispose(); $master.Dispose() }
  try {
    for($py=0;$py -lt $targetHeight;$py++) { for($px=0;$px -lt $targetWidth;$px++) {
      $pixel=$pip.GetPixel($px,$py)
      $largest=[Math]::Max($pixel.R,[Math]::Max($pixel.G,$pixel.B))
      $smallest=[Math]::Min($pixel.R,[Math]::Min($pixel.G,$pixel.B))
      if($largest -gt 165 -and $largest-$smallest -lt 48) {
        $pip.SetPixel($px,$py,[System.Drawing.Color]::Transparent)
      } elseif($pixel.R -gt $pixel.G*1.3 -and $pixel.R -gt $pixel.B*1.3) {
        $pip.SetPixel($px,$py,$pipColor)
      } elseif($largest -lt 180) {
        $pip.SetPixel($px,$py,$pipColor)
      } else {
        $pip.SetPixel($px,$py,[System.Drawing.Color]::Transparent)
      }
    }}
    $graphics.DrawImage($pip,[int][Math]::Round($x),[int][Math]::Round($y),$targetWidth,$targetHeight)
  } finally { $pip.Dispose() }
}

function Get-InkBounds([System.Drawing.Bitmap]$bitmap) {
  $left=$bitmap.Width; $top=$bitmap.Height; $right=-1; $bottom=-1
  for($py=0;$py -lt $bitmap.Height;$py++) { for($px=0;$px -lt $bitmap.Width;$px++) {
    if($bitmap.GetPixel($px,$py).A -gt 8) {
      if($px -lt $left){$left=$px}; if($px -gt $right){$right=$px}
      if($py -lt $top){$top=$py}; if($py -gt $bottom){$bottom=$py}
    }
  }}
  if($right -lt $left -or $bottom -lt $top) { throw 'Rank glyph produced no visible pixels.' }
  return (New-Object System.Drawing.Rectangle $left,$top,($right-$left+1),($bottom-$top+1))
}

function Draw-RankAtMasterScale([System.Drawing.Graphics]$graphics,[string]$rank,[System.Drawing.Color]$color) {
  # The four generated 2s establish the target cap-height and upper-left area.
  # Rasterising then fitting the ink avoids font ascent differences between ranks.
  $canvas = New-Object System.Drawing.Bitmap 1000,650,([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $canvasGraphics = [System.Drawing.Graphics]::FromImage($canvas)
  $brush = New-Object System.Drawing.SolidBrush $color
  $font = New-Object System.Drawing.Font 'Comic Sans MS',340,([System.Drawing.FontStyle]::Bold),([System.Drawing.GraphicsUnit]::Pixel)
  try {
    $canvasGraphics.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $canvasGraphics.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $canvasGraphics.DrawString($rank,$font,$brush,55,-58)
  } finally { $font.Dispose();$brush.Dispose();$canvasGraphics.Dispose() }
  try {
    $sourceBounds=Get-InkBounds $canvas
    $targetHeight=256
    $naturalWidth=[int][Math]::Round($sourceBounds.Width*$targetHeight/$sourceBounds.Height)
    # Keep a two-character 10 inside the same top-left card zone without
    # shrinking its cap height.
    $targetWidth=[Math]::Min($naturalWidth,250)
    $targetX=84
    $targetY=45
    $destination=New-Object System.Drawing.Rectangle $targetX,$targetY,$targetWidth,$targetHeight
    $graphics.DrawImage($canvas,$destination,$sourceBounds,[System.Drawing.GraphicsUnit]::Pixel)
  } finally { $canvas.Dispose() }
}

function Draw-Card([string]$rank,[string]$suit,[System.Drawing.Color]$pipColor,[string]$destination) {
  $bitmap = New-Object System.Drawing.Bitmap $width,$height,([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $brush = New-Object System.Drawing.SolidBrush $pipColor
  $paperBrush = New-Object System.Drawing.SolidBrush $paper
  $border = New-Object System.Drawing.Pen $black,7
  try {
    $graphics.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $frame=New-RoundedPath 9 9 ($width-18) ($height-18) 34
    $graphics.FillPath($paperBrush,$frame)
    $graphics.DrawPath($border,$frame)
    $frame.Dispose()
    Draw-RankAtMasterScale $graphics $rank $pipColor
    Draw-MasterPip $graphics $suit $pipColor 62 295 230 245 $true
    Draw-MasterPip $graphics $suit $pipColor 280 480 480 445 $false
  } finally { $paperBrush.Dispose();$border.Dispose();$brush.Dispose();$graphics.Dispose() }
  Clear-OutsideCard $bitmap
  try { $bitmap.Save($destination,[System.Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
}

if(-not (Test-Path -LiteralPath $SourcePath)) { throw "Source cards folder was not found." }
New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null
$expected = 0
foreach($suit in $suits) {
  foreach($rank in $ranks) {
    $sourceFile=Join-Path $SourcePath ("0x{0}{1}.png" -f $suit.Hex,$rank.Code)
    if(-not (Test-Path -LiteralPath $sourceFile)) { throw "Missing source card: $sourceFile" }
    $destination=Join-Path $OutputPath ("{0}_{1}.png" -f $suitNames[$suit.Key],$rank.Label)
    $color=if($suit.IsRed){$red}else{$black}
    if($rank.Label -eq '2') { Normalize-Master (Join-Path $MasterPath $suit.Master) $color $destination } else { Draw-Card $rank.Label $suit.Key $color $destination }
    $expected++
  }
}
$written=@(Get-ChildItem -LiteralPath $OutputPath -File -Filter '*.png')
if($written.Count -ne $expected) { throw "Expected $expected generated faces; found $($written.Count)." }
Write-Output "Generated $expected flat Q-style card faces. Card backs were not touched."
