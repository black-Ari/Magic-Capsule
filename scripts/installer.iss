; The Magic Capsule installer, compiled by Inno Setup. scripts\build.js passes AppVersion, SourceDir and OutputDir.
#define AppName "Magic Capsule"
#define AppExe "Magic Capsule.exe"

[Setup]
; Unchanged since the app was called Nook, so Windows replaces it instead of listing two apps.
AppId={{7E1C9A54-6D3B-4F2E-9C41-2B8A5F60D3E7}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=via
DefaultDirName={autopf}\{#AppName}
UsePreviousAppDir=no
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

[InstallDelete]
; The program and shortcuts from when the app was called Nook. Your data in %APPDATA%\Nook is not
; touched: the app keeps using that folder.
Type: filesandordirs; Name: "{autopf}\Nook"
Type: files; Name: "{autoprograms}\Nook.lnk"
Type: files; Name: "{autodesktop}\Nook.lnk"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; %LOCALAPPDATA%\Programs often carries permissions from other apps' sandboxes. Electron then refuses
; to start until the folder also allows all app packages, so this has to run on every install.
Filename: "{sys}\icacls.exe"; Parameters: """{app}"" /grant *S-1-15-2-1:(OI)(CI)(RX)"; Flags: runhidden
Filename: "{app}\{#AppExe}"; Description: "Start {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
// CloseApplications looks only in the new folder, so a running Nook is closed here. The first installer
// of all also needs its own uninstaller run, or Windows lists two copies.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  OldFolder, OldUninstaller: String;
  Code, Tries: Integer;
begin
  Result := '';
  OldFolder := ExpandConstant('{autopf}\Nook');
  if FileExists(OldFolder + '\Nook.exe') then begin
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM Nook.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Sleep(1000);
  end;
  OldUninstaller := OldFolder + '\Uninstall Nook.exe';
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
