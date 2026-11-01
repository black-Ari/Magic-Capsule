# Security

## Reporting a problem

Please do not open a public issue for a security problem. Use **Report a vulnerability** on the repository's [Security tab](https://github.com/black-Ari/Magic-Capsule/security) so it can be fixed before details are public.

Include what you found, how to reproduce it, and which version you used. Never include a real API key.

## Supported versions

Only the latest release gets security fixes.

## How your data is protected

- **API keys** are encrypted with Windows DPAPI and can only be read on your PC, by your Windows account. The app shows only the last four characters. Keys are never written to backups.
- **Everything else** stays in your local data folder. There is no account, no telemetry and no server of ours.
- **The page is sandboxed.** The interface runs with `sandbox` and `contextIsolation` on and `nodeIntegration` off, and it reaches the rest of the app only through an allow-list of methods.

## What to be careful with

The AI Agent has real power on your PC, so these limits matter:

- It sends what it sees to the AI provider you chose, only while a task runs: screenshots, window contents, file contents and command output.
- A web page or file can try to mislead the AI. Read each command before you allow it.
- **Turbo** removes those questions. Use it only with an AI and sites you trust. Moving the mouse or pressing Ctrl+Alt+Q still stops the Agent, and a restored backup always turns Turbo off.
- **Tool servers (MCP)** are programs with whatever power you give them. Add only ones you trust.
- **Phone Drop and phone control** use plain HTTP on your local network, protected by a random link. Use them on your own Wi-Fi only.
