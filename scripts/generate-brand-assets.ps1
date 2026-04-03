Add-Type -AssemblyName System.Drawing

$primaryGreen = [System.Drawing.ColorTranslator]::FromHtml('#97B87E')
$white = [System.Drawing.ColorTranslator]::FromHtml('#FFFFFF')

function Convert-Point([float]$value, [float]$size) {
  return [float](($value / 100.0) * $size)
}

function Draw-Receipt([System.Drawing.Graphics]$graphics, [float]$size, [float]$offsetX) {
  $points = @(
    [System.Drawing.PointF]::new((Convert-Point (31 + $offsetX) $size), (Convert-Point 27 $size)),
    [System.Drawing.PointF]::new((Convert-Point (33.1 + $offsetX) $size), (Convert-Point 24.9 $size)),
    [System.Drawing.PointF]::new((Convert-Point (35.6 + $offsetX) $size), (Convert-Point 27 $size)),
    [System.Drawing.PointF]::new((Convert-Point (38.1 + $offsetX) $size), (Convert-Point 24.7 $size)),
    [System.Drawing.PointF]::new((Convert-Point (40.8 + $offsetX) $size), (Convert-Point 27 $size)),
    [System.Drawing.PointF]::new((Convert-Point (43.5 + $offsetX) $size), (Convert-Point 24.8 $size)),
    [System.Drawing.PointF]::new((Convert-Point (46.1 + $offsetX) $size), (Convert-Point 27 $size)),
    [System.Drawing.PointF]::new((Convert-Point (48.3 + $offsetX) $size), (Convert-Point 24.9 $size)),
    [System.Drawing.PointF]::new((Convert-Point (49.4 + $offsetX) $size), (Convert-Point 27 $size)),
    [System.Drawing.PointF]::new((Convert-Point (50 + $offsetX) $size), (Convert-Point 36.5 $size)),
    [System.Drawing.PointF]::new((Convert-Point (47.5 + $offsetX) $size), (Convert-Point 44 $size)),
    [System.Drawing.PointF]::new((Convert-Point (49.8 + $offsetX) $size), (Convert-Point 52 $size)),
    [System.Drawing.PointF]::new((Convert-Point (47.2 + $offsetX) $size), (Convert-Point 60 $size)),
    [System.Drawing.PointF]::new((Convert-Point (48.7 + $offsetX) $size), (Convert-Point 69.5 $size)),
    [System.Drawing.PointF]::new((Convert-Point (46.2 + $offsetX) $size), (Convert-Point 77 $size)),
    [System.Drawing.PointF]::new((Convert-Point (43.6 + $offsetX) $size), (Convert-Point 74.9 $size)),
    [System.Drawing.PointF]::new((Convert-Point (40.8 + $offsetX) $size), (Convert-Point 77 $size)),
    [System.Drawing.PointF]::new((Convert-Point (38.1 + $offsetX) $size), (Convert-Point 74.7 $size)),
    [System.Drawing.PointF]::new((Convert-Point (35.4 + $offsetX) $size), (Convert-Point 77 $size)),
    [System.Drawing.PointF]::new((Convert-Point (33 + $offsetX) $size), (Convert-Point 74.8 $size)),
    [System.Drawing.PointF]::new((Convert-Point (31 + $offsetX) $size), (Convert-Point 77 $size))
  )
  $graphics.FillPolygon((New-Object System.Drawing.SolidBrush($white)), $points)
}

function Draw-ReceiptMirror([System.Drawing.Graphics]$graphics, [float]$size, [float]$offsetX) {
  $points = @(
    [System.Drawing.PointF]::new((Convert-Point (50 + $offsetX) $size), (Convert-Point 27 $size)),
    [System.Drawing.PointF]::new((Convert-Point (51.4 + $offsetX) $size), (Convert-Point 24.9 $size)),
    [System.Drawing.PointF]::new((Convert-Point (53.7 + $offsetX) $size), (Convert-Point 27 $size)),
    [System.Drawing.PointF]::new((Convert-Point (56.4 + $offsetX) $size), (Convert-Point 24.8 $size)),
    [System.Drawing.PointF]::new((Convert-Point (59.2 + $offsetX) $size), (Convert-Point 27 $size)),
    [System.Drawing.PointF]::new((Convert-Point (61.9 + $offsetX) $size), (Convert-Point 24.7 $size)),
    [System.Drawing.PointF]::new((Convert-Point (64.5 + $offsetX) $size), (Convert-Point 27 $size)),
    [System.Drawing.PointF]::new((Convert-Point (66.9 + $offsetX) $size), (Convert-Point 24.9 $size)),
    [System.Drawing.PointF]::new((Convert-Point (69 + $offsetX) $size), (Convert-Point 27 $size)),
    [System.Drawing.PointF]::new((Convert-Point (69 + $offsetX) $size), (Convert-Point 77 $size)),
    [System.Drawing.PointF]::new((Convert-Point (67 + $offsetX) $size), (Convert-Point 74.8 $size)),
    [System.Drawing.PointF]::new((Convert-Point (64.5 + $offsetX) $size), (Convert-Point 77 $size)),
    [System.Drawing.PointF]::new((Convert-Point (61.8 + $offsetX) $size), (Convert-Point 74.8 $size)),
    [System.Drawing.PointF]::new((Convert-Point (59.1 + $offsetX) $size), (Convert-Point 77 $size)),
    [System.Drawing.PointF]::new((Convert-Point (56.4 + $offsetX) $size), (Convert-Point 74.7 $size)),
    [System.Drawing.PointF]::new((Convert-Point (53.7 + $offsetX) $size), (Convert-Point 77 $size)),
    [System.Drawing.PointF]::new((Convert-Point (51.3 + $offsetX) $size), (Convert-Point 74.9 $size)),
    [System.Drawing.PointF]::new((Convert-Point (49 + $offsetX) $size), (Convert-Point 69.5 $size)),
    [System.Drawing.PointF]::new((Convert-Point (50.8 + $offsetX) $size), (Convert-Point 60 $size)),
    [System.Drawing.PointF]::new((Convert-Point (48.2 + $offsetX) $size), (Convert-Point 52 $size)),
    [System.Drawing.PointF]::new((Convert-Point (50.5 + $offsetX) $size), (Convert-Point 44 $size)),
    [System.Drawing.PointF]::new((Convert-Point (48 + $offsetX) $size), (Convert-Point 36.5 $size))
  )
  $graphics.FillPolygon((New-Object System.Drawing.SolidBrush($white)), $points)
}

function Draw-Line([System.Drawing.Graphics]$graphics, [float]$size, [float]$x1, [float]$y1, [float]$x2, [float]$y2) {
  $pen = New-Object System.Drawing.Pen($primaryGreen, ($size * 0.016))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($pen, (Convert-Point $x1 $size), (Convert-Point $y1 $size), (Convert-Point $x2 $size), (Convert-Point $y2 $size))
  $pen.Dispose()
}

function Draw-Friend([System.Drawing.Graphics]$graphics, [float]$size, [float]$centerX) {
  $headBrush = New-Object System.Drawing.SolidBrush($white)
  $graphics.FillEllipse($headBrush, (Convert-Point ($centerX - 5.8) $size), (Convert-Point 39.7 $size), (Convert-Point 11.6 $size), (Convert-Point 11.6 $size))
  $bodyPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $bodyPath.AddArc((Convert-Point ($centerX - 8.2) $size), (Convert-Point 49.7 $size), (Convert-Point 16.4 $size), (Convert-Point 12.8 $size), 180, 180)
  $bodyPath.AddLine((Convert-Point ($centerX + 8.2) $size), (Convert-Point 56.1 $size), (Convert-Point ($centerX + 8.2) $size), (Convert-Point 60.8 $size))
  $bodyPath.AddArc((Convert-Point ($centerX - 8.2) $size), (Convert-Point 58.9 $size), (Convert-Point 16.4 $size), (Convert-Point 3.7 $size), 0, 180)
  $bodyPath.CloseFigure()
  $graphics.FillPath($headBrush, $bodyPath)
  $bodyPath.Dispose()
  $headBrush.Dispose()
}

function Draw-Logo([string]$path, [int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear($primaryGreen)

  $cornerPen = New-Object System.Drawing.Pen($white, ($size * 0.03))
  $cornerPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $cornerPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $cornerPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLines($cornerPen, @(
    [System.Drawing.PointF]::new((Convert-Point 18 $size), (Convert-Point 28 $size)),
    [System.Drawing.PointF]::new((Convert-Point 18 $size), (Convert-Point 18 $size)),
    [System.Drawing.PointF]::new((Convert-Point 20 $size), (Convert-Point 16 $size)),
    [System.Drawing.PointF]::new((Convert-Point 31 $size), (Convert-Point 16 $size))
  ))
  $graphics.DrawLines($cornerPen, @(
    [System.Drawing.PointF]::new((Convert-Point 82 $size), (Convert-Point 28 $size)),
    [System.Drawing.PointF]::new((Convert-Point 82 $size), (Convert-Point 18 $size)),
    [System.Drawing.PointF]::new((Convert-Point 80 $size), (Convert-Point 16 $size)),
    [System.Drawing.PointF]::new((Convert-Point 69 $size), (Convert-Point 16 $size))
  ))
  $graphics.DrawLines($cornerPen, @(
    [System.Drawing.PointF]::new((Convert-Point 18 $size), (Convert-Point 72 $size)),
    [System.Drawing.PointF]::new((Convert-Point 18 $size), (Convert-Point 82 $size)),
    [System.Drawing.PointF]::new((Convert-Point 20 $size), (Convert-Point 84 $size)),
    [System.Drawing.PointF]::new((Convert-Point 31 $size), (Convert-Point 84 $size))
  ))
  $graphics.DrawLines($cornerPen, @(
    [System.Drawing.PointF]::new((Convert-Point 82 $size), (Convert-Point 72 $size)),
    [System.Drawing.PointF]::new((Convert-Point 82 $size), (Convert-Point 82 $size)),
    [System.Drawing.PointF]::new((Convert-Point 80 $size), (Convert-Point 84 $size)),
    [System.Drawing.PointF]::new((Convert-Point 69 $size), (Convert-Point 84 $size))
  ))
  $cornerPen.Dispose()

  Draw-Friend $graphics $size 23.2
  Draw-Friend $graphics $size 76.8
  Draw-Receipt $graphics $size -4.3
  Draw-ReceiptMirror $graphics $size 4.3

  Draw-Line $graphics $size 31.7 35 40.2 35
  Draw-Line $graphics $size 31.4 42 40.9 42
  Draw-Line $graphics $size 31.9 49 39.9 49
  Draw-Line $graphics $size 31.5 58 40.5 58
  Draw-Line $graphics $size 31 67 39.6 67
  Draw-Line $graphics $size 59.8 35 68.3 35
  Draw-Line $graphics $size 59.1 42 68.5 42
  Draw-Line $graphics $size 60 49 68 49
  Draw-Line $graphics $size 59.2 58 68.2 58
  Draw-Line $graphics $size 60.3 67 68.9 67

  $directory = Split-Path -Parent $path
  if (!(Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

$root = Split-Path -Parent $PSScriptRoot
Draw-Logo (Join-Path $root 'assets\icon.png') 1024
Draw-Logo (Join-Path $root 'assets\images\icon.png') 1024
Draw-Logo (Join-Path $root 'assets\images\adaptive-icon.png') 1024
Draw-Logo (Join-Path $root 'assets\images\splash-icon.png') 1024
Draw-Logo (Join-Path $root 'assets\images\favicon.png') 256
