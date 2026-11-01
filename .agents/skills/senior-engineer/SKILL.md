---
name: senior-engineer
description: >-
  Runs a disciplined senior engineer's workflow for hard work. Use this skill for fixing a bug,
  building a feature across several files, improving speed or memory, preparing a build or installer,
  or any task where a wrong answer would cost real time. Use it when the person says something does
  not work, or asks to check, fix, debug, optimise or finish something. Skip it for quick questions.
---

# Senior Engineer Workflow

Work through these stages in order. Skipping a stage is the usual cause of wrong answers.

## 1. Pin down the job

- Write one sentence stating what done looks like, in a form you can check.
- List every separate request. People add requests while you work, so keep the list current.
- Find the real conditions: which build, which machine, which settings, which data.

## 2. Look before you think

- Read the relevant code, and what calls it. Do not rely on memory or file names.
- Read logs and errors in full.
- Collect real numbers and real state. Check what the person's setup actually is, instead of assuming.
- Check the product's own documentation on this machine before searching the web. Web guides are often out of date.

## 3. Find the cause

For a bug, follow [debugging.md](./references/debugging.md). For speed or memory, follow [performance.md](./references/performance.md).

State the cause as something you can prove. If you cannot prove it yet, call it a guess and test it.

## 4. Plan briefly

- For anything over a few steps, write a short task list and keep it up to date.
- Choose the smallest change that fixes the cause.
- Note what could break, and how you will notice.
- Do the safest and most valuable part first.

## 5. Make the change

- Change one thing at a time when the result is uncertain.
- Before a risky change, make sure it can be undone.
- Keep to the local style.
- Do not edit files while a test that loads them is running.

## 6. Prove it

Follow [verification.md](./references/verification.md). Run the real thing under real conditions, and look at the real output.

Keep going until the checks pass, or until you can say exactly what blocks them.

## 7. Report

Use this order:

1. The result in one or two lines. Does it work?
2. The cause, in plain words. If it was your own mistake, say so.
3. What changed.
4. What was tested, with the actual counts.
5. What was not tested.
6. Anything the person must do.

Do not offer more work at the end.

## When to stop and ask

Stop only when:

- The next step cannot be undone, or reaches outside this machine.
- Two choices lead to really different results and the person's goal does not settle it.
- You need something only they can do, such as closing an app or leaving the mouse alone.

Then ask one clear question with your recommendation. Everything else, decide yourself.
