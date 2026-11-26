# Tries the Windows helper against the Orders app in tests/fixtures. It has to run in the
# signed-in session, where the app's window is:
#
#   powershell -File windows-check.ps1 -Helper praecise-computer-helper.exe -App orders-winforms.exe -Out result.txt
#
# Each line of the result starts with "ok" or "FAIL".
param([string]$Helper, [string]$App, [string]$Out)
$ErrorActionPreference = "Stop"
Set-Content -Encoding UTF8 $Out ""
# Each line is written as it is known, so a check that stops says how far it got.
function Say($ok, $what) { if ($ok) { Add-Content -Encoding UTF8 $Out "ok   $what" } else { Add-Content -Encoding UTF8 $Out "FAIL $what" } }
$A = "orders-winforms"
try {
  $orders = Start-Process -FilePath $App -PassThru
  [void]$orders.WaitForInputIdle(15000)
  $info = New-Object System.Diagnostics.ProcessStartInfo $Helper
  $info.UseShellExecute = $false; $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.CreateNoWindow = $true
  $speaking = [System.Diagnostics.Process]::Start($info)
  $script:n = 0
  function Call($method, $params) {
    $script:n++
    $speaking.StandardInput.WriteLine((@{ id = $script:n; method = $method; params = $params } | ConvertTo-Json -Compress -Depth 6))
    $speaking.StandardInput.Flush()
    $answer = $speaking.StandardOutput.ReadLineAsync()
    if (-not $answer.Wait(20000)) { throw "the helper did not answer $method in 20 seconds" }
    return ($answer.Result | ConvertFrom-Json)
  }
  function Worked() { return @((Call "read" @{ app = $A; filter = "interactive" }).result) }
  function One($list, $role, $name) { return $list | Where-Object { $_.role -eq $role -and $_.name -eq $name } | Select-Object -First 1 }
  function Middle($element) { return @{ x = [int]($element.box.x + $element.box.width / 2); y = [int]($element.box.y + $element.box.height / 2) } }
  function Settle() { [System.Threading.Thread]::Sleep(400) }

  $hello = (Call "hello" @{}).result
  Say ($hello.system -eq "windows" -and $hello.needs[0].ok) "hello: windows, in the signed-in session"
  Say (@((Call "apps" @{}).result | Where-Object { $_.id -eq $A }).Count -eq 1) "apps lists the app"
  $window = (Call "window" @{ app = $A }).result
  Say ($window.width -gt 100 -and $window.title -eq "Orders") "window: $($window.width) by $($window.height), titled $($window.title)"

  $worked = Worked
  $field = One $worked "textbox" "Name"; $save = One $worked "button" "Save"; $paid = One $worked "checkbox" "Paid only"
  Say ($field -and $field.value -eq "old") "reads the field with what it holds"
  Say ([bool]$save) "reads the Save button"
  Say ($paid -and -not ($paid.states -contains "checked")) "reads the checkbox, unchecked"
  Say ((Worked | Where-Object { $_.ref -eq $save.ref }).name -eq "Save") "the same element has the same reference on a second reading"
  $tree = @((Call "read" @{ app = $A }).result)
  Say ($tree.Count -eq 1 -and $tree[0].role -eq "window" -and $tree[0].name -eq "Orders") "the whole reading is one window named Orders"
  Say (@($tree[0].children | Where-Object { $_.role -eq "text" -and $_.name -eq "Not saved." }).Count -eq 1) "reads the line of text"

  $filled = Call "fill" @{ app = $A; ref = $field.ref; value = "new name" }
  Say (-not $filled.error -and (One (Worked) "textbox" "Name").value -eq "new name") "fill replaces what the field holds"

  $pressed = Call "activate" @{ app = $A; ref = $save.ref }
  Settle
  $after = @((Call "read" @{ app = $A }).result)
  Say (-not $pressed.error -and @($after[0].children | Where-Object { $_.name -eq "Saved new name" }).Count -eq 1) "pressing Save without the pointer saves"
  Say (-not (One (Worked) "button" "Save")) "the Save button has gone"
  $stale = Call "locate" @{ app = $A; ref = $save.ref }
  Say ($stale.error -match "no longer in the window") "a reference whose element has gone is refused: $($stale.error)"
  Say ((Call "locate" @{ app = $A; ref = "e99999" }).error -match "not a reference") "a reference never given is refused"

  $shot = (Call "screenshot" @{ app = $A }).result
  $bytes = [Convert]::FromBase64String($shot.data)
  Say ($shot.mime -eq "image/png" -and $bytes[1] -eq 0x50 -and $bytes[2] -eq 0x4E -and $bytes.Length -gt 1000) "a picture of the window: $($bytes.Length) bytes of PNG"
  Add-Type -AssemblyName System.Drawing
  $seen = New-Object System.Drawing.Bitmap (New-Object System.IO.MemoryStream (,$bytes))
  $colours = @{}
  for ($x = 4; $x -lt $seen.Width; $x += 9) { for ($y = 4; $y -lt $seen.Height; $y += 9) { $colours[$seen.GetPixel($x, $y).ToArgb()] = 1 } }
  Say ($seen.Width -eq $window.width -and $seen.Height -eq $window.height -and $colours.Count -ge 4) "the picture is the window's size and shows something: $($seen.Width) by $($seen.Height), $($colours.Count) colours sampled"
  $zoom = (Call "screenshot" @{ app = $A; region = @{ x = 0; y = 0; width = 200; height = 100 } }).result
  Say ($zoom.name -eq "zoom.png" -and $zoom.data.Length -gt 1000) "a region enlarged"

  $paid = One (Worked) "checkbox" "Paid only"
  $clicked = Call "click" @{ app = $A; at = (Middle $paid); button = "left"; count = 1; modifiers = @() }
  Settle
  Say (-not $clicked.error -and ((One (Worked) "checkbox" "Paid only").states -contains "checked")) "a click at a position checks the checkbox"
  $toggled = Call "activate" @{ app = $A; ref = $paid.ref }
  Settle
  Say (-not $toggled.error -and -not ((One (Worked) "checkbox" "Paid only").states -contains "checked")) "pressing it without the pointer unchecks it"

  $field = One (Worked) "textbox" "Name"
  [void](Call "click" @{ app = $A; at = (Middle $field); button = "left"; count = 1; modifiers = @() })
  Settle
  $typed = Call "type" @{ app = $A; text = "X1" }
  Settle
  Say (-not $typed.error -and (One (Worked) "textbox" "Name").value -match "X1") "typing goes into the field that was clicked: $((One (Worked) 'textbox' 'Name').value)"
  Say ((Call "key" @{ app = $A; combo = "ctrl+a" }).error -match "holds a key down") "a chord is refused"
  Say (-not (Call "key" @{ app = $A; combo = "End" }).error) "a single key is sent"
  Say (-not (Call "move" @{ app = $A; to = @{ x = 20; y = 20 } }).error) "a move is sent"
  Say (-not (Call "scroll" @{ app = $A; at = @{ x = 20; y = 20 }; by = @{ dx = 0; dy = 2 }; modifiers = @() }).error) "a scroll is sent"
  Say ((Call "click" @{ app = $A; at = @{ x = 99999; y = 5 }; button = "left"; count = 1; modifiers = @() }).error -match "outside the window") "a position outside the window is refused"
  $at = (Call "cursor" @{ app = $A }).result
  Say ($at.x -eq 20 -and $at.y -eq 20) "the pointer is where it was last put"
  Say ((Call "window" @{ app = "no-such-app" }).error -match "not running") "an app that is not running says so"
  Say ((Call "dance" @{}).error -match "cannot dance") "an unknown method says so"
} catch {
  Add-Content -Encoding UTF8 $Out ("FAIL the check itself stopped: " + $_.Exception.Message)
} finally {
  if ($speaking -and -not $speaking.HasExited) { Stop-Process -Id $speaking.Id -Force }
  if ($orders -and -not $orders.HasExited) { Stop-Process -Id $orders.Id -Force }
}
