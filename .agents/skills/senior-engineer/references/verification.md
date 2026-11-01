# Verification

Done means you saw it work. Pick the checks that fit the change, and run them.

## By type of change

| Change | Check |
|---|---|
| Logic | Unit tests, including the failure cases |
| Bug fix | The exact steps that failed, then a new test that fails without the fix |
| User interface | Render it, take a screenshot and open the picture. Check small sizes and long text. |
| Art or animation | Look at it in each state, frozen and zoomed in. Layering and offset bugs do not fail tests. |
| Mouse, focus or windows | A real mouse in a real window, with a human pause. Include the moving and second-time cases. |
| Speed or memory | Before and after numbers from the same measurement |
| Saved data | Old data still loads. Check an upgrade, not only a fresh install. |
| Security | Try the attack: a wrong key, an old message, a path that climbs out of its folder, a password box. |
| Installer | Install into the real location, start the real app with real settings, then uninstall. |
| Mobile app | Install on a real device or emulator, and run it there. Building it proves nothing. |

## The checks people skip

- **Second time through.** Run an action twice. Many bugs appear only after the first close.
- **Default settings.** Test with what real users have on, not what makes the test easy.
- **The installed build.** Test what ships, as well as the source.
- **Other windows of the same action.** If there are two ways to do something, test both.
- **Failure paths.** No network, wrong key, missing file, permission refused.
- **Clean up.** A test must restore what it changed, including the screen, settings and the mouse.

## Before you say done

Answer these honestly:

1. What exactly did I run, and what did I see?
2. Was it the real build, in real conditions?
3. What did my test turn off or fake?
4. Could my test have passed even with the bug still there?
5. What did the last full run cover, and what has changed since?
6. What have I not tested? Say this in the report.

## Side effects of testing

Testing changes the machine too, so check what your test touched:

- A test install can share an ID with the real app, so uninstalling it can remove the real app's entry. Restore it, and tell the person.
- A test window can take keyboard focus from the person.
- A test may overwrite the clipboard or change settings.

Report any side effect, and put things back as you found them.

## Reporting

Give counts, not adjectives: "unit 75/75, e2e 61/61", and name what was skipped. If a run happened before your last change, say so.
