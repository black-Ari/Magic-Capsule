# Quick settings for the Control tab. helper.ps1 loads this the first time it is needed, so a Magic Capsule that
# never opens the tab does not carry it. Functions are declared script: to outlive that first call.
Add-Type -Path (Join-Path $PSScriptRoot 'helper-control.cs')
$null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
$null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
$null = [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
$null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]

$script:themeKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$script:cameraKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam'
$script:nightLightKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate'
$script:powerKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes'
$script:nightLightOn = 0x15
$script:nightLightOff = 0x13
$script:flagAt = 18
$script:extraAt = 23 # where the setting carries two more bytes while it is on

function script:Wait-Slow($operation, [type]$resultType) {
  $task = $script:asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(12000)) { throw 'Windows took too long' }
  $task.Result
}

function script:Get-Radio([string]$kind) {
  $list = [System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]
  Wait-Slow ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) $list | Where-Object { "$($_.Kind)" -eq $kind } | Select-Object -First 1
}

function script:Get-RadioOn([string]$kind) {
  $radio = Get-Radio $kind
  if ($null -eq $radio) { return $null }
  "$($radio.State)" -eq 'On'
}

function script:Set-Radio([string]$kind, [bool]$on) {
  $radio = Get-Radio $kind
  if ($null -eq $radio) { throw "This PC has no $kind" }
  $access = [Windows.Devices.Radios.RadioAccessStatus]
  $null = Wait-Slow ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) $access
  $state = if ($on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
  $result = Wait-Slow ($radio.SetStateAsync($state)) $access
  if ("$result" -ne 'Allowed') { throw "Windows refused to change $kind ($result)" }
}

function script:Get-Dark {
  (Get-ItemProperty -Path $script:themeKey -Name AppsUseLightTheme -ErrorAction Stop).AppsUseLightTheme -eq 0
}

function script:Set-Dark([bool]$on) {
  $light = if ($on) { 0 } else { 1 }
  Set-ItemProperty -Path $script:themeKey -Name AppsUseLightTheme -Value $light -Type DWord
  Set-ItemProperty -Path $script:themeKey -Name SystemUsesLightTheme -Value $light -Type DWord
  [NookCtl.Control]::ThemeChanged()
}

function script:Get-NightLightData {
  if (-not (Test-Path -LiteralPath $script:nightLightKey)) { return $null }
  [byte[]](Get-ItemProperty -LiteralPath $script:nightLightKey -Name Data).Data
}

function script:Get-NightLight {
  $data = Get-NightLightData
  if ($null -eq $data) { return $null }
  $data[$script:flagAt] -eq $script:nightLightOn
}

# Windows keeps this as a small binary record with no public way to change it. A new time stamp
# inside it is what makes Windows notice the change.
function script:Set-NightLight([bool]$on) {
  $data = Get-NightLightData
  if ($null -eq $data) { throw 'Open Night light in Windows Settings once, then try again' }
  if (($data[$script:flagAt] -eq $script:nightLightOn) -eq $on) { return }
  $bytes = New-Object System.Collections.Generic.List[byte]
  $bytes.AddRange([byte[]]$data)
  if ($on) {
    $bytes[$script:flagAt] = $script:nightLightOn
    $bytes.InsertRange($script:extraAt, [byte[]](0x10, 0x00))
  } else {
    $bytes[$script:flagAt] = $script:nightLightOff
    $bytes.RemoveRange($script:extraAt, 2)
  }
  foreach ($index in 10..14) {
    if ($bytes[$index] -ne 0xFF) { $bytes[$index] = [byte]($bytes[$index] + 1); break }
  }
  Set-ItemProperty -LiteralPath $script:nightLightKey -Name Data -Value $bytes.ToArray() -Type Binary
}

function script:Get-Camera {
  (Get-ItemProperty -Path $script:cameraKey -Name Value -ErrorAction Stop).Value -ne 'Deny'
}

function script:Set-Camera([bool]$on) {
  $value = if ($on) { 'Allow' } else { 'Deny' }
  Set-ItemProperty -Path $script:cameraKey -Name Value -Value $value -Type String
}

function script:Get-Tethering {
  $connection = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if ($null -eq $connection) { return $null }
  [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($connection)
}

function script:Get-Hotspot {
  $manager = Get-Tethering
  if ($null -eq $manager) { return $null }
  "$($manager.TetheringOperationalState)" -eq 'On'
}

function script:Set-Hotspot([bool]$on) {
  $manager = Get-Tethering
  if ($null -eq $manager) { throw 'The hotspot needs an internet connection to share' }
  $operation = if ($on) { $manager.StartTetheringAsync() } else { $manager.StopTetheringAsync() }
  $result = Wait-Slow $operation ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  if ("$($result.Status)" -ne 'Success') { throw "Windows could not change the hotspot ($($result.Status))" }
}

function script:Get-PowerOverlay {
  $values = Get-ItemProperty -Path $script:powerKey -ErrorAction Stop
  "$($values.ActiveOverlayAcPowerScheme)"
}

function script:Get-ControlState {
  @{
    wifi = Get-RadioOn 'WiFi'
    bluetooth = Get-RadioOn 'Bluetooth'
    dark = Get-Dark
    nightLight = Get-NightLight
    quiet = [NookCtl.Control]::GetQuiet() -ne 0
    camera = Get-Camera
    hotspot = Get-Hotspot
    powerOverlay = Get-PowerOverlay
  }
}

function script:Set-Toggle([string]$name, [bool]$on) {
  switch ($name) {
    'wifi' { Set-Radio 'WiFi' $on }
    'bluetooth' { Set-Radio 'Bluetooth' $on }
    'dark' { Set-Dark $on }
    'nightLight' { Set-NightLight $on }
    'quiet' { [NookCtl.Control]::SetQuiet($(if ($on) { 1 } else { 0 })) }
    'camera' { Set-Camera $on }
    'hotspot' { Set-Hotspot $on }
    default { throw "Unknown setting: $name" }
  }
}

function script:Get-BluetoothDevices {
  $devices = @{}
  $classic = [Windows.Devices.Bluetooth.BluetoothDevice]
  $selector = $classic::GetDeviceSelectorFromPairingState($true)
  $found = Wait-Slow ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($selector)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
  foreach ($item in $found) {
    if (-not $item.Name) { continue }
    $connected = $false
    try {
      $device = Wait-Slow ($classic::FromIdAsync($item.Id)) $classic
      $connected = "$($device.ConnectionStatus)" -eq 'Connected'
    } catch {
      # Low-energy devices are listed too, but do not open this way. They just show as not connected.
    }
    $devices[$item.Name] = $connected -or [bool]$devices[$item.Name]
  }
  @($devices.GetEnumerator() | ForEach-Object { @{ name = $_.Key; connected = $_.Value } })
}

function script:Start-Sleeping {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)
}

function script:Clear-Bin {
  Clear-RecycleBin -Force -ErrorAction SilentlyContinue
}
