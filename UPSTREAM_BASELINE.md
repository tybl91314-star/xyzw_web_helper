# Upstream baseline

This customized Android/mobile branch is based on:

- Upstream repository: `https://github.com/w1249178256/xyzw_web_helper.git`
- Upstream branch: `upstream/main`
- Baseline commit: `59f305de4df9a5f71e94f712688d97814a692b8f`
- Short commit: `59f305d`
- Upstream commit date: `2026-07-27`
- Upstream subject: `Merge pull request #373 from 150148313/feat/salt`
- Local integration commit before the mobile customization snapshot:
  `37409809171cd195a242c5bb951afc1a9396933f`

The full baseline hash is also stored in `.upstream-baseline` so scripts can
compare it without relying on a moving branch name.

## Checking future upstream updates

Run from PowerShell:

```powershell
./scripts/compare-upstream.ps1
```

The report shows:

1. the recorded baseline and current `upstream/main` commit;
2. the number of all upstream commits since the baseline;
3. the number and titles of first-parent integrations (normally merged PRs or
   direct mainline updates);
4. the complete commit list and changed-file summary.

Before merging a future upstream version, review the changed files against the
mobile-specific files on this branch. Integrate only the relevant upstream
changes, reapply mobile adaptations where the same code changed, run the web
tests/build, synchronize Capacitor, and build both Debug and Release APKs.

After a successful upstream integration, update `.upstream-baseline` and this
document to the new upstream commit in the same commit as that integration.
