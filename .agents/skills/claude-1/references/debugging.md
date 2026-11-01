# Debugging

## The method

1. **Reproduce it.** Use the same steps, build and settings as the person. If you cannot reproduce it, you cannot claim to have fixed it.
2. **Read the error in full.** Turn on logging if there is none. Error messages often name the fix.
3. **Write down what differs** between where it works and where it fails. The cause is almost always in that difference.
4. **Change one thing at a time.** Test the guess that would be most useful to rule out.
5. **Prove the cause.** A good cause explains every symptom, including why your earlier test passed.
6. **Fix the cause**, then run the exact steps that failed.
7. **Search for the same mistake elsewhere.**

## Patterns that waste days

### Your test does not match reality

If it works in your test and fails for the person, stop guessing about the code and compare the conditions.

Real examples:

- An installer passed in a temp folder and crashed in the real install folder, because that folder inherited different permissions. The app's own log named the exact fix.
- A click test passed with a feature switched off, while the person had it on. The bug lived in that feature.

Ask: what did my test turn off, simplify or fake?

### A confounded experiment

A test with two changes tells you nothing. A click test reported failures and seemed to blame one feature. The real difference was that the script clicked at the instant the mouse arrived, with no human pause. Keep the steps human, and vary one thing.

### Reading the result too quickly

Read skipped and odd results as carefully as failures. In one run, 10 clicks worked and 2 were skipped because the target had moved away. Those two skips were the real bug, and a quick read would have called the run a pass.

### The first failure causes the rest

Fix the first failure in a run, then run again. Later failures are often the same problem. One failed step left a window closed, and that made three later steps fail for no reason of their own.

### Flaky tests

A test that fails sometimes is telling you something. Print the actual values, then run that test alone several times. Possible causes:

- A real background event arriving mid-test, such as a low-memory alert.
- Something reading state before it has loaded.
- A person typing while the test window has focus. Caps Lock has failed a reminder test this way.

If the code is right and the test is the weak part, fix the test so it waits for the true condition. Never just add a longer sleep, and never delete the check.

### Silent drop-offs

When a change seems to do nothing, check the path it travels. Look for allow-lists of events, permissions, feature flags, caches, stale builds, and whether the running app is really the new code.

### Name collisions

Two fields with the same name can overwrite each other with no error. A request's own `id` was overwritten by a device `id`, so its reply was never matched and the call just timed out. When a call hangs, check how the reply finds its request.

### A cleanup that hides the truth

A test that changes the system and does not restore it breaks everything after it, including its own exit. One test replaced `app.quit` and never put it back, so the run hung forever after passing every step.

## When you are stuck

- Add a probe that prints the real state at the failure point.
- Ask what evidence would prove your idea wrong, and go and get it.
- Go back to the last thing you verified, and move forward from there.
- After two failed fixes, stop patching. You have the cause wrong.
