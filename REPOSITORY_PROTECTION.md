# Repository Protection

## Current Baseline

- `LICENSE` declares this repository as proprietary and all-rights-reserved.
- Source files in `server`, `webapp`, and `find_website` should carry a
  repository-wide copyright notice.
- The GitHub repository is intended to stay private unless the owner approves a
  different publication model.
- `main` should be protected with pull-request-based review before merge.

## Header Automation

Use the repository-owned automation script:

```bash
python3 scripts/repo_protection.py apply
python3 scripts/repo_protection.py audit
```

The script:

- inserts the repository notice into supported tracked source files
- preserves shebang lines
- skips binary/generated content
- fails `audit` when the `LICENSE` file or required headers are missing

## GitHub Enforcement

### Repository Visibility

Keep the repository visibility as `Private` on GitHub unless the owner approves
an intentional release or publication event.

### Branch Protection

Protect `main` with at least these settings:

- require a pull request before merging
- require at least one approval review when feasible
- consider requiring the `CI` workflow before merge

If you have repository admin access, configure it in GitHub Settings or through
the GitHub API. The current CI workflow names are:

- `Repository Protection Audit`
- `Webapp Lint & Build`
- `Server PyTest`

## Copyright Enforcement / DMCA

If code from this repository is copied or re-published without authorization:

1. Preserve evidence: offending URL, screenshots, timestamps, and copied files.
2. Compare the copied material against the original repository history.
3. Review GitHub's DMCA policy and submit the official copyright form.

Official GitHub references:

- DMCA policy: <https://docs.github.com/site-policy/content-removal-policies/dmca-takedown-policy>
- Copyright claims form: <https://support.github.com/contact/dmca>

## Operational Notes

- This document is repository governance guidance, not a product PRD change.
- If the copyright owner name changes, update `LICENSE`,
  `scripts/repo_protection.py`, and the source-file headers together.
