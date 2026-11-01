; The Nook installer, compiled by Inno Setup. scripts\build.js passes AppVersion, SourceDir and OutputDir.
#define AppName "Nook"
#define AppExe "Nook.exe"

[Setup]
AppId={{7E1C9A54-6D3B-4F2E-9C41-2B8A5F60D3E7}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=via
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename={#AppName} Setup {#AppVersion}
SetupIconFile={#SourcePath}..\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; %LOCALAPPDATA%\Programs often carries permissions from other apps' sandboxes. Electron then refuses
; to start until the folder also allows all app packages, so this has to run on every install.
Filename: "{sys}\icacls.exe"; Parameters: """{app}"" /grant *S-1-15-2-1:(OI)(CI)(RX)"; Flags: runhidden
Filename: "{app}\{#AppExe}"; Description: "Start Nook"; Flags: nowait postinstall skipifsilent

[Code]
// The old installer put Nook in the same folder. It has to go first, or Windows lists two copies.
// Your data lives in %APPDATA%\Nook and is kept.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  OldUninstaller: String;
  Code, Tries: Integer;
begin
  Result := '';
  OldUninstaller := ExpandConstant('{app}\Uninstall Nook.exe');
  if not FileExists(OldUninstaller) then Exit;
  Exec(OldUninstaller, '/S /currentuser /KEEP_APP_DATA', '', SW_HIDE, ewWaitUntilTerminated, Code);
  // It hands over to a temporary copy of itself and returns early, so wait until it has really finished.
  Tries := 0;
  while FileExists(OldUninstaller) and (Tries < 80) do begin
    Sleep(500);
    Tries := Tries + 1;
  end;
  if FileExists(OldUninstaller) then
    Result := 'The old Nook could not be removed. Uninstall it from Windows Settings, then run this again.';
end;
