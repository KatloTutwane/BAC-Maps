param([string]$Logo, [string]$OutDir)
# Draws square app icons: the BAC logo centred on white.
# $frac is the logo width as a share of the icon width. Maskable icons keep
# the logo inside the central safe circle (80% of the width), so it is smaller.
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null
$src = [System.Drawing.Image]::FromFile($Logo)

function Make-Icon([int]$size, [double]$frac, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'HighQuality'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::White)
  $w = [int]($size * $frac)
  $h = [int]($w * $src.Height / $src.Width)
  $x = [int](($size - $w) / 2)
  $y = [int](($size - $h) / 2)
  $g.DrawImage($src, $x, $y, $w, $h)
  $g.Dispose()
  $path = Join-Path $OutDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "$name  ${size}x${size}  logo ${w}x${h}"
}

Make-Icon 192 0.72 'icon-192.png'
Make-Icon 512 0.72 'icon-512.png'
Make-Icon 512 0.58 'icon-maskable-512.png'
Make-Icon 180 0.72 'apple-touch-icon.png'
Make-Icon 32  0.86 'favicon-32.png'
$src.Dispose()
