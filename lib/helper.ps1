# Windows helper. Speaks JSON lines: commands on stdin, replies and events on stdout.
# It exits on its own when stdin closes, so it can never outlive the app.
# helper-service.exe does the watching and this script starts with -OnDemand for the other commands.
# Without that program, this script does everything.
param([switch]$OnDemand)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
# Loading the compiled program skips compiling the same code here, which takes a second or two.
try { Add-Type -Path (Join-Path $PSScriptRoot 'helper-service.exe') }
catch { Add-Type -Path (Join-Path $PSScriptRoot 'helper-native.cs') }

# Without this, display scaling skews window sizes and full-screen apps are not recognised.
[void][NookNative]::SetProcessDPIAware()

function Send-Json($object) {
  [Console]::Out.WriteLine(($object | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}

# WinRT async -> blocking result
$script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Wait-Op($operation, [type]$resultType) {
  $task = $script:asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(3000)) { throw 'media call timed out' }
  $task.Result
}

if (-not $OnDemand) {
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
  $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $inputType = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  # PowerShell cannot pick this overload for a raw WinRT object, so it is called through reflection.
  $script:asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@($inputType))
  $script:manager = Wait-Op ($managerType::RequestAsync()) $managerType
}
$script:mediaKey = ''
$script:artKey = ''

function Get-Art($props) {
  if ($null -eq $props.Thumbnail) { return $null }
  $stream = Wait-Op ($props.Thumbnail.OpenReadAsync()) $streamType
  $reader = $script:asStream.Invoke($null, @($stream))
  try {
    $memory = New-Object System.IO.MemoryStream
    $reader.CopyTo($memory)
    if ($memory.Length -eq 0 -or $memory.Length -gt 3MB) { return $null }
    $bytes = $memory.ToArray()
    $type = if ($bytes[0] -eq 0xFF) { 'image/jpeg' } else { 'image/png' }
    "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } finally {
    $reader.Dispose()
  }
}

# Players report a position plus the moment they reported it, then expect us to count forward.
function Get-Position($timeline, $playing) {
  $seconds = $timeline.Position.TotalSeconds
  if ($playing -and $timeline.LastUpdatedTime.Year -gt 2000) {
    $seconds += ([DateTimeOffset]::Now - $timeline.LastUpdatedTime).TotalSeconds
  }
  $end = $timeline.EndTime.TotalSeconds
  if ($end -gt 0) { $seconds = [math]::Min($seconds, $end) }
  [math]::Round($seconds)
}

function Update-Media {
  $session = $script:manager.GetCurrentSession()
  if ($null -eq $session) {
    if ($script:mediaKey -ne 'none') {
      $script:mediaKey = 'none'
      $script:artKey = ''
      Send-Json @{ event = 'media'; data = $null }
    }
    return
  }
  $props = Wait-Op ($session.TryGetMediaPropertiesAsync()) $propsType
  $info = $session.GetPlaybackInfo()
  $timeline = $session.GetTimelineProperties()
  $playing = [int]$info.PlaybackStatus -eq 4
  $track = "$($session.SourceAppUserModelId)|$($props.Title)|$($props.Artist)"
  $key = "$track|$playing|$($timeline.Position.Ticks)|$($timeline.LastUpdatedTime.Ticks)"
  if ($key -eq $script:mediaKey) { return }
  $script:mediaKey = $key
  Send-Json @{ event = 'media'; data = @{
    app = $session.SourceAppUserModelId
    title = $props.Title
    artist = $props.Artist
    album = $props.AlbumTitle
    playing = $playing
    position = Get-Position $timeline $playing
    duration = [math]::Round($timeline.EndTime.TotalSeconds)
    canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled
  } }
  if ($track -ne $script:artKey) {
    $script:artKey = $track
    $art = $null
    try { $art = Get-Art $props } catch {}
    Send-Json @{ event = 'art'; data = $art }
  }
}

function Invoke-Media($action, $seconds) {
  $session = $script:manager.GetCurrentSession()
  if ($null -eq $session) { return $false }
  $operation = switch ($action) {
    'toggle' { $session.TryTogglePlayPauseAsync() }
    'next' { $session.TrySkipNextAsync() }
    'prev' { $session.TrySkipPreviousAsync() }
    'seek' { $session.TryChangePlaybackPositionAsync([long]($seconds * 10000000)) }
    default { throw "unknown media action $action" }
  }
  Wait-Op $operation ([bool])
}

$script:volumeKey = ''
function Update-Volume {
  $volume = [NookNative]::GetVolume()
  $key = "$($volume.Percent)|$($volume.Muted)"
  if ($key -eq $script:volumeKey) { return }
  $script:volumeKey = $key
  Send-Json @{ event = 'volume'; data = @{ percent = $volume.Percent; muted = $volume.Muted } }
}

$script:lockState = [NookNative]::LockKeys()
function Update-LockKeys {
  $state = [NookNative]::LockKeys()
  if ($state -eq $script:lockState) { return }
  $old = $script:lockState.Split(',')
  $new = $state.Split(',')
  $script:lockState = $state
  foreach ($i in 0..2) {
    if ($old[$i] -ne $new[$i]) {
      Send-Json @{ event = 'lockkey'; data = @{ key = @('Caps Lock', 'Num Lock', 'Scroll Lock')[$i]; on = $new[$i] -eq '1' } }
    }
  }
}

$script:clipSeq = [NookNative]::GetClipboardSequenceNumber()
function Update-Clipboard {
  $seq = [NookNative]::GetClipboardSequenceNumber()
  if ($seq -eq $script:clipSeq) { return }
  $script:clipSeq = $seq
  Send-Json @{ event = 'clip'; data = @{ sensitive = [NookNative]::ClipboardIsSensitive() } }
}

$script:appNames = @{}
function Get-AppName([uint32]$processId) {
  if ($processId -eq 0) { return '' }
  if ($script:appNames.ContainsKey($processId)) { return $script:appNames[$processId] }
  $name = ''
  try {
    $process = Get-Process -Id $processId
    $name = $process.ProcessName
    try { if ($process.Description) { $name = $process.Description } } catch {}
  } catch {}
  if ($script:appNames.Count -gt 200) { $script:appNames.Clear() }
  $script:appNames[$processId] = $name
  $name
}

function Update-Foreground {
  $foreground = [NookNative]::Foreground()
  Send-Json @{ event = 'foreground'; data = @{
    app = Get-AppName $foreground.Pid
    pid = $foreground.Pid
    handle = $foreground.Handle
    x = $foreground.CenterX
    y = $foreground.CenterY
    fullscreen = $foreground.Fullscreen
    idle = [NookNative]::IdleSeconds()
  } }
}

function Get-Brightness {
  $monitor = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $monitor) { return $null }
  [int]$monitor.CurrentBrightness
}

function Set-Brightness([int]$percent) {
  $methods = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1
  Invoke-CimMethod -InputObject $methods -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$percent } | Out-Null
}

function Get-NetTotals {
  $rx = [long]0
  $tx = [long]0
  foreach ($adapter in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($adapter.OperationalStatus -ne 'Up' -or $adapter.NetworkInterfaceType -eq 'Loopback') { continue }
    $stats = $adapter.GetIPStatistics()
    $rx += $stats.BytesReceived
    $tx += $stats.BytesSent
  }
  @{ rx = $rx; tx = $tx }
}

# Memory per app, adding up all of an app's processes. Windows' own housekeeping is left out.
function Get-TopApps {
  $skip = 'Idle', 'System', 'Registry', 'Memory Compression', 'Secure System', 'vmmem', 'smss', 'csrss', 'wininit'
  $apps = foreach ($group in (Get-Process | Group-Object ProcessName)) {
    if ($skip -contains $group.Name) { continue }
    $bytes = [long]0
    foreach ($process in $group.Group) { $bytes += $process.WorkingSet64 }
    [pscustomobject]@{ name = $group.Name; bytes = $bytes }
  }
  @($apps | Sort-Object bytes -Descending | Select-Object -First 5)
}

$script:keyCodes = @{
  ctrl = 0x11; control = 0x11; alt = 0x12; shift = 0x10; win = 0x5B; windows = 0x5B; enter = 0x0D; return = 0x0D; tab = 0x09
  esc = 0x1B; escape = 0x1B; space = 0x20; backspace = 0x08; delete = 0x2E; del = 0x2E; insert = 0x2D; home = 0x24; end = 0x23
  pageup = 0x21; pagedown = 0x22; up = 0x26; down = 0x28; left = 0x25; right = 0x27
}

function Get-KeyCodes([string]$combo) {
  $codes = foreach ($name in ($combo.ToLower() -split '\+' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    if ($script:keyCodes.ContainsKey($name)) { $script:keyCodes[$name] }
    elseif ($name -match '^f([1-9]|1[0-9]|2[0-4])$') { 0x6F + [int]$Matches[1] }
    elseif ($name -match '^[a-z0-9]$') { [int][char]$name.ToUpper() }
    else { throw "Unknown key: $name" }
  }
  [int[]]@($codes)
}

function Open-StartApp([string]$name) {
  $apps = @(Get-StartApps)
  $short = $name -replace '^(microsoft|ms)\s+', ''
  $pattern = [WildcardPattern]::Escape($short)
  $app = @(
    $apps | Where-Object { $_.Name -eq $short }
    $apps | Where-Object { $_.Name -like "$pattern*" }
    $apps | Where-Object { $_.Name -like "*$pattern*" }
  ) | Select-Object -First 1
  if ($null -eq $app) { throw "No installed app is called $name" }
  Start-Process explorer.exe "shell:AppsFolder\$($app.AppID)"
  $app.Name
}

# Compiled on first use, so a Nook that never runs the agent does not carry it.
function Use-NookUi {
  if ($script:uiReady) { return }
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
  $references = @([System.Windows.Automation.AutomationElement], [System.Windows.Automation.ControlType], [System.Windows.Rect]) |
    ForEach-Object { $_.Assembly.Location }
  Add-Type -Path (Join-Path $PSScriptRoot 'helper-ui.cs') -ReferencedAssemblies $references
  $script:uiReady = $true
}

function Use-NookControl {
  if ($script:controlReady) { return }
  . (Join-Path $PSScriptRoot 'helper-control.ps1')
  $script:controlReady = $true
}

function Invoke-Command-Line($line) {
  $request = $line | ConvertFrom-Json
  $reply = @{ id = $request.id; ok = $true; data = $null }
  try {
    switch ($request.cmd) {
      'media' { $reply.data = Invoke-Media $request.action $request.seconds; $script:mediaKey = '' }
      'media.refresh' { $script:mediaKey = ''; $script:artKey = '' }
      'locks.get' { $reply.data = $script:lockState }
      'volume.get' { $v = [NookNative]::GetVolume(); $reply.data = @{ percent = $v.Percent; muted = $v.Muted } }
      'volume.set' { [NookNative]::SetVolume([int]$request.percent) }
      'volume.step' { [NookNative]::SetVolume([NookNative]::GetVolume().Percent + [int]$request.delta); [NookNative]::SetMute($false) }
      'volume.mute' { [NookNative]::SetMute(-not [NookNative]::GetVolume().Muted) }
      'input.click' { [NookNative]::Click([int]$request.x, [int]$request.y, [string]$request.button, [bool]$request.double) }
      'input.drag' { [NookNative]::Drag([int]$request.fromX, [int]$request.fromY, [int]$request.toX, [int]$request.toY) }
      'input.scroll' { [NookNative]::Scroll([int]$request.x, [int]$request.y, [int]$request.notches) }
      'input.type' { [NookNative]::TypeText([string]$request.text) }
      'input.keys' { [NookNative]::PressKeys((Get-KeyCodes ([string]$request.keys))) }
      'apps.open' { $reply.data = Open-StartApp ([string]$request.name) }
      'control.state' { Use-NookControl; $reply.data = Get-ControlState }
      'control.set' { Use-NookControl; Set-Toggle ([string]$request.name) ([bool]$request.on) }
      'control.bluetooth' { Use-NookControl; $reply.data = @(Get-BluetoothDevices) }
      'control.outputs' { Use-NookControl; $reply.data = [NookCtl.Control]::Outputs() }
      'control.output' { Use-NookControl; [NookCtl.Control]::SetOutput([string]$request.device) }
      'remote.move' { Use-NookControl; [NookCtl.Control]::MoveBy([int]$request.dx, [int]$request.dy) }
      'remote.click' { Use-NookControl; [NookCtl.Control]::ClickHere(([string]$request.button -eq 'right'), [bool]$request.double) }
      'remote.scroll' { Use-NookControl; [NookCtl.Control]::ScrollHere([int]$request.notches) }
      'control.sleep' { Use-NookControl; Start-Sleeping }
      'control.screenOff' { Use-NookControl; [NookCtl.Control]::ScreenOff() }
      'control.emptyBin' { Use-NookControl; Clear-Bin }
      'windows.list' { Use-NookUi; $reply.data = [NookUi]::ListWindows() }
      'windows.focus' { Use-NookUi; $reply.data = [NookUi]::Focus([long]$request.handle) }
      'windows.close' { Use-NookUi; [NookUi]::Close([long]$request.handle) }
      'ui.read' { Use-NookUi; $reply.data = [NookUi]::Read([long]$request.handle, [int]$request.limit, [int]$request.budget) }
      'ui.click' {
        Use-NookUi
        $point = [NookUi]::Target([int]$request.element)
        [NookNative]::Click($point[0], $point[1], 'left', $false)
      }
      'mic.get' { $reply.data = [NookNative]::MicMuted() }
      'mic.set' { [NookNative]::SetMicMuted([bool]$request.muted) }
      'brightness.get' { $reply.data = Get-Brightness }
      'brightness.set' { Set-Brightness ([int]$request.percent) }
      'net.totals' { $reply.data = Get-NetTotals }
      'top.apps' { $reply.data = Get-TopApps }
      default { throw "unknown command $($request.cmd)" }
    }
  } catch {
    $reply.ok = $false
    $reply.error = "$($_.Exception.Message)"
  }
  Send-Json $reply
}

# Console.In blocks in ReadLineAsync on .NET Framework, so read the raw stream instead.
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$readTask = $reader.ReadLineAsync()
$nextFast = [DateTime]::MinValue
$nextSlow = [DateTime]::MinValue
Send-Json @{ event = 'ready'; data = $true }

while ($true) {
  if ($readTask.Wait(100)) {
    $line = $readTask.Result
    if ($null -eq $line) { break }
    Invoke-Command-Line $line
    $readTask = $reader.ReadLineAsync()
  }
  if ($OnDemand) { continue }
  $now = [DateTime]::UtcNow
  try {
    if ($now -ge $nextFast) {
      $nextFast = $now.AddMilliseconds(300)
      Update-Clipboard
      Update-Volume
      Update-LockKeys
    }
    if ($now -ge $nextSlow) {
      $nextSlow = $now.AddMilliseconds(1000)
      Update-Media
      Update-Foreground
    }
  } catch {
    [Console]::Error.WriteLine("tick failed: $($_.Exception.Message)")
  }
}
