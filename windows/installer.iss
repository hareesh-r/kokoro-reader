; Inno Setup script. Build: ISCC /DAppVersion=0.3.8 windows\installer.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{3F7A9C52-8D41-4E6B-B0A7-5C2E19D4F8A1}
AppName=Kokoro Reader
AppVersion={#AppVersion}
AppPublisher=Hareesh Rajendran
AppPublisherURL=https://github.com/hareesh-r/kokoro-reader
DefaultDirName={autopf}\Kokoro Reader
DefaultGroupName=Kokoro Reader
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=KokoroReader-Setup-{#AppVersion}
SetupIconFile=icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Kokoro Reader

[Files]
Source: "kokoro-reader.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.DS_Store,README.txt"

[Icons]
Name: "{group}\Kokoro Reader extension folder"; Filename: "{app}\extension"
Name: "{group}\Kokoro Reader server status"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -NoExit -File ""{app}\kokoro-reader.ps1"" status"
Name: "{group}\Restart Kokoro Reader server"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -NoExit -File ""{app}\kokoro-reader.ps1"" restart"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\kokoro-reader.ps1"" install"; StatusMsg: "Installing the voice server and model (about 330 MB). This takes a few minutes..."; Flags: waituntilterminated
Filename: "{app}\extension"; Description: "Open the extension folder (then load it in chrome://extensions)"; Flags: shellexec postinstall skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\kokoro-reader.ps1"" uninstall"; Flags: waituntilterminated runhidden; RunOnceId: "KokoroReaderUninstall"
