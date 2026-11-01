# Magic Capsule

A personal notch for Windows 10 and 11. It sits at the top of the screen as a small capsule and opens into your music, calendar, tasks, a control panel for Windows, and an AI that can work on your PC. It is inspired by the ideas in Poni and Vayli. All code and artwork here are original.

Move the mouse to the top of the screen or press **Alt+N** to open it. Press **Esc** to close it.

## Run it

You need [Node.js](https://nodejs.org). To build the installer you also need [Inno Setup](https://jrsoftware.org/isinfo.php) 6 or 7.

```
git clone https://github.com/black-Ari/Magic-Capsule.git
cd Magic-Capsule
run.bat
```

| File | What it does |
|---|---|
| `run.bat` | Starts Magic Capsule from this folder (runs setup the first time) |
| `setup.bat` | Installs dependencies to `%USERPROFILE%\.build_workspaces\poni`, outside Google Drive |
| `build.bat` | Builds the installer into `dist\` with Inno Setup 6 or 7 |

Choose Magic Capsule's screens in Settings > General: the main screen, every screen, one screen, or the screen your mouse is on. With every screen, each has its own notch and tab while your data stays the same on all, and each extra screen uses more memory. Fit to each screen sizes the open notch for that screen.

Do not run Poni and Magic Capsule together. Both want Alt+N and the volume keys, and whichever starts second loses them. Magic Capsule warns you when this happens, and you can change its shortcut in Settings > General.

## What is inside

- **Tools:** Home (music, next up, day progress), Calendar, Tasks, Notes, Timers, Weather, Clipboard, Shelf, Phone Drop, Units, AI, Control, System, Health, Links.
- **Closed notch:** live activities, side extras, lyrics, alerts for volume, lock keys, battery and reminders.
- **Phone:** open the page on your phone with its QR code, with nothing to install. Send files and text, and with your permission use the phone as a touchpad, keyboard, media remote, slide clicker and button deck, and lock the PC.
- **Memory and history:** the History page in the AI tab keeps your past chats and agent tasks. Search them, reopen a chat, or delete them. Tell the AI what to remember, or add it yourself. Give your pet a name and the AI answers with it.
- **Control panel:** the Control tab does what Windows Quick Settings does, and more. Turn Wi-Fi, Bluetooth, flight mode, the mobile hotspot, dark mode, night light, Do not disturb, camera access, the microphone and stay-awake on or off. Connect the VPNs saved in Windows, see your Bluetooth devices, choose where sound comes out, set the power mode and second-screen mode, lock, sleep, restart or shut down, empty the Recycle Bin, and open Task Manager or any Settings page. The AI Agent can change these too. Restart and Shut down wait 20 seconds and can be cancelled.
- **Pet:** a cute avatar under the notch with a reaction for everything: a different look for code, the terminal, Excel, Word, chats, video calls, videos, games, drawing, browsing and files, and for finished tasks, timers, reminders, copying, volume, low battery, the charger, Wi-Fi, Bluetooth, dark mode, VPN and the AI thinking. It greets you by the time of day, plays by itself when nothing is happening, has tea or lunch at the right time, opens an umbrella when it rains, purrs when you point at it, and sleeps when you are away. Try every reaction in Settings > Pet. Pick a pet, an original hero or a Hindu deity, or build your own. Deities use calm reactions: they glow and bless instead of dancing or sleeping. Click the avatar to open AI Chat. It never reads your keystrokes: in other apps it reacts to the app name and activity only.
- **Any AI you save:** use Gemini, Claude, Ollama, or add as many of your own APIs as you like in Settings > AI (name, address, key, model). Most APIs accept the OpenAI format, so OpenRouter, Groq, DeepSeek, Mistral, xAI and Together are one click away. **Test this API** finds out what a model can really do. A model without tool calling gets text tools, and one that cannot see pictures reads the screen as text.
- **AI Agent:** give it a task and it works on your PC. It can run PowerShell commands, read and change files, search your folders, read any window as text and click its buttons by name, use its own browser window, search the web, work with Excel and Word, and use screenshots, mouse and keyboard when nothing else fits. It sees every connected screen. It asks before acting unless you allow the whole task. Commands, file changes, deletes and memories ask every single time, unless you allow them for the session or use Turbo. Moving your mouse while it clicks or types, or pressing Ctrl+Alt+Q, stops it.
- **Permissions:** a new chat lets you choose Ask me each time, Allow for this session, or Turbo. Every question also offers Allow for this session, for that kind of action. A session lasts until New chat or until Magic Capsule closes. **Turbo** never asks: the Agent runs commands, changes files and deletes by itself until you turn it off with the red badge in the AI tab. Ctrl+Alt+Q and moving the mouse still stop it, the AI still will not type passwords or pay, and a restored backup always turns Turbo off.
- **Long jobs:** the AI keeps a plan, older steps are summarised from its own notes so a long task never overflows, and you set the step limit in Settings > AI. Say "remember that..." and it keeps the fact for future chats and tasks, after asking you. Every fact is listed in Settings > AI, where you can delete it.
- **Tool servers (MCP):** add a server in Settings > AI and its tools work with every AI. Each call asks first unless you choose Ask per task.
- **Skills:** add your own in Settings > AI, set each one to Auto (used when your message needs it), Always or Off, force one with the Skills button or by typing /skill-name, and give the AI files with the + button or by dropping them on the AI tab.
- **Settings:** a searchable menu with look, size, place, shortcuts, auto-hide, pet, tools, backup and privacy.

## Good to know

- **Data:** everything stays in `%APPDATA%\Magic Capsule`, or in `%APPDATA%\Nook` if you used the app under its old name. API keys are encrypted with Windows DPAPI.
- **Goes online only for:** weather (Open-Meteo), currency rates (open.er-api.com), lyrics when turned on (lrclib.net), your calendar links, your chosen AI provider, and during an agent task, web search (DuckDuckGo), the sites it reads, and any tool server you add.
- **AI Agent** sends what it sees to the AI provider you chose, only while a task runs: screenshots, window contents, file contents and command output. Text in a password box is never read. It can make mistakes, so stay near the PC, and keep "Ask before every action" for anything important. Read each command before you allow it, because a web page or file can try to mislead the AI. Better models do this work better: every AI gets the same tools, not the same judgement. It cannot control apps running as administrator.
- **Agent browser:** a separate Chrome or Edge window with its own profile in the data folder. It never touches your usual browser or its saved passwords, and it refuses to type into password boxes, so you sign in there yourself.
- **Tool servers** are programs with the power you give them, so add only ones you trust. A restored backup turns them all off until you turn them on again. Their secrets are encrypted like API keys and are not in backups.
- **Phone Drop** is plain HTTP on your local network, protected by a random link. It stops after 15 idle minutes. Use it on your own Wi-Fi only.
- **Phone control** is off until you tick it in the Phone tab, and turns off when sharing stops. It is plain HTTP too, so on a shared Wi-Fi someone could read the link and use your PC. Keep it to your own network.
- **Wi-Fi list:** Windows requires Location to be on before any app can read it.
- **Control panel limits:** flight mode here turns off Wi-Fi and Bluetooth, because Windows has no public switch for the real one. VPN apps such as Proton VPN are used from their own window: only VPNs saved in Windows connect from Magic Capsule. Windows connects Bluetooth devices by itself, so Magic Capsule lists them and pairing stays in Windows Settings. Night light, Do not disturb and the sound output use parts of Windows that are not officially published, so a Windows update could change them.
- **Clipboard:** items marked private by password managers are not recorded.

## Tests

Quit Magic Capsule and Poni first. `helper.js` compares the compiled helper with PowerShell, `windows.js` opens a small window and a browser, `e2e.js` and `desktop.js` start the real app, and `desktop.js` also moves the mouse and presses keys.

```
node tests\unit.js
node tests\helper.js
node tests\windows.js
node tests\e2e.js <folder for screenshots>
node tests\desktop.js <folder for screenshots>
```

`node tests\live-ai.js` checks your real AI provider with one small request.

## License

All rights reserved. No license has been granted.
