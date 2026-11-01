# Speed and Memory

Measure first. Guesses about performance are usually wrong, and a change you did not measure is only a risk.

## The method

1. Write a repeatable measurement, and record a baseline.
2. Find the biggest cost. Work on that, not on what is easiest.
3. Change one thing.
4. Measure the same way. Keep it only if the numbers improved and nothing broke.
5. Commit each kept change, so any of them can be undone.
6. Measure on the installed build at the end.

Measure over time, not once. Compare the first minute, ten minutes and one hour, because leaks only show over time.

## Numbers that matter on Windows

- **Working set:** RAM in use right now. Windows can trim it, so a low figure may be temporary.
- **Private bytes:** memory that belongs to the process alone. Use this to spot leaks.
- **CPU as a share of one core:** idle CPU is what keeps a laptop warm and slow. Sample for at least 10 seconds.

Add up every process, including helpers. Electron always runs several.

## Electron: where memory goes

| Process | What fills it | What reduces it |
|---|---|---|
| Main | Modules loaded at startup, caches kept in memory | Load modules on first use. Do not keep large data in memory. |
| Renderer | Loaded JavaScript, DOM, images | Dynamic `import()`, emptying hidden views, smaller lists |
| GPU | Window size and layers | Smaller windows, fewer layers. Test hardware acceleration off. |
| Helpers | Whatever you spawned | Replace a heavy runtime with a small native program |

## Idle CPU: the usual causes

- Fast polling loops. Slow them when nothing is happening, or use system events.
- `setInterval` in hidden views. Stop timers while a view is not visible.
- `backgroundThrottling: false`, which keeps every timer at full speed.
- Endless CSS animation. A transparent window repaints what it animates, so run animation in short bursts.
- Many small timers. One scheduler that sleeps until the next due time does the same job.

## Smoothness

- Animate only `transform` and `opacity`. Animating size or position forces layout.
- A frame has 16 ms. Anything over 50 ms on the main thread is a visible stutter.
- Do no synchronous disk or network work in the main process.
- Add `contain: layout paint` around independent panels.
- Limit long lists to what is on screen.
- Lower the frame rate on purpose where it suits the style. Stepped 12 fps movement costs far less than 60 fps.

## Traps

- **An option that makes things worse.** Turning off GPU acceleration can move the cost to the CPU. Measure both sides.
- **A low number that lies.** Trimmed memory comes back as soon as the app works again. Measure in use too.
- **Saving memory by losing a feature.** That is removing something, not optimising it. Put it behind a setting.
- **Slowing something people feel.** A slower mouse poll saves CPU, but hover must still feel instant. Test by hand.
- **A late reminder.** Sleeping timers must still fire on time. Test that directly.
- **New executables.** A small unsigned `.exe` can trigger antivirus. Test this, and keep a fallback.
