# Long-running Windows helper. Speaks JSON lines: commands on stdin, replies and events on stdout.
# It exits on its own when stdin closes, so it can never outlive the app.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorCom {}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr args, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
  [PreserveSig] int GetChannelCount(out int count);
  [PreserveSig] int SetMasterVolumeLevel(float db, ref Guid ctx);
  [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
  [PreserveSig] int GetMasterVolumeLevel(out float db);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
  [PreserveSig] int SetChannelVolumeLevel(uint channel, float db, ref Guid ctx);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid ctx);
  [PreserveSig] int GetChannelVolumeLevel(uint channel, out float db);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

public class NookVolume {
  public int Percent;
  public bool Muted;
}

public class NookForeground {
  public uint Pid;
  public bool Fullscreen;
  public long Handle;
  public int CenterX;
  public int CenterY;
}

public static class NookNative {
  [StructLayout(LayoutKind.Sequential)]
  struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  struct MONITORINFO { public int Size; public RECT Monitor; public RECT Work; public uint Flags; }

  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO { public uint Size; public uint Time; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int X; public int Y; public uint Data; public uint Flags; public uint Time; public IntPtr Extra; }

  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort Vk; public ushort Scan; public uint Flags; public uint Time; public IntPtr Extra; }

  [StructLayout(LayoutKind.Explicit)]
  struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT Mouse; [FieldOffset(0)] public KEYBDINPUT Key; }

  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint Type; public INPUTUNION U; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern short GetKeyState(int key);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
  [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr handle);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr handle);

  static readonly uint ExcludeFormat = RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
  static readonly uint HistoryFormat = RegisterClipboardFormat("CanIncludeInClipboardHistory");

  // Password managers mark what they copy; such items are never recorded. CanIncludeInClipboardHistory
  // is a number, 0 meaning "keep out of history". If the value cannot be read, assume it is private.
  public static bool ClipboardIsSensitive() {
    if (IsClipboardFormatAvailable(ExcludeFormat)) return true;
    if (!IsClipboardFormatAvailable(HistoryFormat)) return false;
    if (!OpenClipboard(IntPtr.Zero)) return true;
    try {
      IntPtr handle = GetClipboardData(HistoryFormat);
      IntPtr data = handle == IntPtr.Zero ? IntPtr.Zero : GlobalLock(handle);
      if (data == IntPtr.Zero) return true;
      try { return Marshal.ReadInt32(data) == 0; } finally { GlobalUnlock(handle); }
    } finally {
      CloseClipboard();
    }
  }

  public static NookForeground Foreground() {
    NookForeground result = new NookForeground();
    IntPtr hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero) return result;
    GetWindowThreadProcessId(hwnd, out result.Pid);
    result.Handle = hwnd.ToInt64();

    StringBuilder name = new StringBuilder(64);
    GetClassName(hwnd, name, name.Capacity);
    string cls = name.ToString();
    if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") return result;

    RECT rect;
    MONITORINFO info = new MONITORINFO();
    info.Size = Marshal.SizeOf(typeof(MONITORINFO));
    if (GetWindowRect(hwnd, out rect) && GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref info)) {
      result.CenterX = (rect.Left + rect.Right) / 2;
      result.CenterY = (rect.Top + rect.Bottom) / 2;
      result.Fullscreen = rect.Left <= info.Monitor.Left && rect.Top <= info.Monitor.Top
        && rect.Right >= info.Monitor.Right && rect.Bottom >= info.Monitor.Bottom;
    }
    return result;
  }

  static void Send(params INPUT[] inputs) {
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length) {
      throw new InvalidOperationException("Windows blocked the input. The app in front may be running as administrator.");
    }
  }

  static INPUT MouseEvent(uint flags, uint data) {
    INPUT input = new INPUT();
    input.U.Mouse.Flags = flags;
    input.U.Mouse.Data = data;
    return input;
  }

  static INPUT KeyEvent(ushort vk, ushort scan, uint flags) {
    INPUT input = new INPUT();
    input.Type = 1;
    input.U.Key.Vk = vk;
    input.U.Key.Scan = scan;
    input.U.Key.Flags = flags;
    return input;
  }

  public static void Click(int x, int y, string button, bool twice) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(60);
    uint down = button == "right" ? 8u : 2u;
    for (int i = 0; i < (twice ? 2 : 1); i++) {
      Send(MouseEvent(down, 0));
      Send(MouseEvent(down * 2, 0));
      System.Threading.Thread.Sleep(50);
    }
  }

  public static void Drag(int fromX, int fromY, int toX, int toY) {
    SetCursorPos(fromX, fromY);
    System.Threading.Thread.Sleep(80);
    Send(MouseEvent(2, 0));
    for (int step = 1; step <= 12; step++) {
      SetCursorPos(fromX + (toX - fromX) * step / 12, fromY + (toY - fromY) * step / 12);
      System.Threading.Thread.Sleep(16);
    }
    Send(MouseEvent(4, 0));
  }

  public static void Scroll(int x, int y, int notches) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(60);
    Send(MouseEvent(0x800, unchecked((uint)(notches * 120))));
  }

  public static void TypeText(string text) {
    foreach (char c in text) {
      if (c == '\n') { Send(KeyEvent(13, 0, 0), KeyEvent(13, 0, 2)); continue; }
      if (c == '\r') continue;
      Send(KeyEvent(0, c, 4), KeyEvent(0, c, 6));
      System.Threading.Thread.Sleep(4);
    }
  }

  public static void PressKeys(int[] keys) {
    try {
      foreach (int key in keys) Send(KeyEvent((ushort)key, 0, 0));
    } finally {
      for (int i = keys.Length - 1; i >= 0; i--) Send(KeyEvent((ushort)keys[i], 0, 2));
    }
  }

  // Only the on/off state of the three lock keys. No other key is ever read.
  public static string LockKeys() {
    return (GetKeyState(0x14) & 1) + "," + (GetKeyState(0x90) & 1) + "," + (GetKeyState(0x91) & 1);
  }

  public static uint IdleSeconds() {
    LASTINPUTINFO info = new LASTINPUTINFO();
    info.Size = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    if (!GetLastInputInfo(ref info)) return 0;
    return (uint)(Environment.TickCount - (int)info.Time) / 1000;
  }

  static IAudioEndpointVolume Endpoint(int flow = 0) { // 0 speakers, 1 microphone
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(flow, 1, out device));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object iface;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out iface));
    return (IAudioEndpointVolume)iface;
  }

  public static NookVolume GetVolume() {
    IAudioEndpointVolume endpoint = Endpoint();
    float level;
    bool muted;
    Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out level));
    Marshal.ThrowExceptionForHR(endpoint.GetMute(out muted));
    NookVolume result = new NookVolume();
    result.Percent = (int)Math.Round(level * 100);
    result.Muted = muted;
    return result;
  }

  public static void SetVolume(int percent) {
    Guid ctx = Guid.Empty;
    float level = Math.Max(0, Math.Min(100, percent)) / 100f;
    Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(level, ref ctx));
  }

  public static void SetMute(bool mute) {
    Guid ctx = Guid.Empty;
    Marshal.ThrowExceptionForHR(Endpoint().SetMute(mute, ref ctx));
  }

  public static bool MicMuted() {
    bool muted;
    Marshal.ThrowExceptionForHR(Endpoint(1).GetMute(out muted));
    return muted;
  }

  public static void SetMicMuted(bool mute) {
    Guid ctx = Guid.Empty;
    Marshal.ThrowExceptionForHR(Endpoint(1).SetMute(mute, ref ctx));
  }
}
'@

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

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$inputType = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
# PowerShell cannot pick this overload for a raw WinRT object, so it is called through reflection.
$script:asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@($inputType))
$script:manager = Wait-Op ($managerType::RequestAsync()) $managerType
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
