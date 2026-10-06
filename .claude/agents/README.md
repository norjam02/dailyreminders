# Reviewer agents

Five agent definitions copied from [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) at commit `83294689da3832c0a9f223221148c411fd3eacc0`, under the MIT license in `LICENSE-agency-agents`. Claude Code picks up agents in this folder automatically.

| Agent | Use it to |
| --- | --- |
| `code-reviewer.md` | Review a change for correctness, security, maintainability, and tests |
| `security-architect.md` | Threat-model a feature and check access rules, sign-in, and data handling |
| `accessibility-auditor.md` | Check screens against WCAG 2.2 AA; many users are older parents |
| `mobile-app-builder.md` | Check React Native and Expo patterns, push, camera, and offline behavior |
| `reality-checker.md` | Decide whether a build is ready for the pilot, based on evidence |

The first review using them is in `docs/review-2026-10-05.md`.
