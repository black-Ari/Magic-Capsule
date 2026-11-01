# Contributing

Thanks for helping. Small, focused changes are the easiest to review.

## Set up

You need Windows 10 or 11 and [Node.js](https://nodejs.org).

```bat
git clone https://github.com/black-Ari/Magic-Capsule.git
cd Magic-Capsule
run.bat
```

`run.bat` installs dependencies the first time. They go to `%USERPROFILE%\.build_workspaces\poni`, so a project kept in Google Drive does not sync thousands of files.

## Before you open a pull request

1. Quit Magic Capsule and Poni. The tests refuse to run while either is open.
2. Run the tests that cover your change:

   ```bat
   node tests\unit.js
   node tests\helper.js
   node tests\windows.js
   node tests\e2e.js %TEMP%\capsule-shots
   node tests\desktop.js %TEMP%\capsule-shots
   ```

   `desktop.js` moves the real mouse and presses real keys, so leave the PC alone while it runs.
3. If you changed how something looks, include a screenshot.
4. If you claim a speed or memory gain, include before and after numbers. `scripts\measure.ps1` helps.

## House rules

- The project is plain JavaScript with no build step. Keep it that way.
- Memory counts: the app should stay light on a low-end laptop. Do not add a dependency or a background timer without a reason.
- Tests use a throwaway folder through `NOOK_USER_DATA`. Never point them at real data.
- Never commit an API key, a `.env` file or personal data.
- Do not turn off the Agent's safety checks, such as the password rules or the stop shortcut.

## Reporting bugs

Use the [issue form](https://github.com/black-Ari/Magic-Capsule/issues/new/choose). For security problems, follow [SECURITY.md](SECURITY.md) instead.
