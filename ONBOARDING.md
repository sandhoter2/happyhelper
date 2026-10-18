# Welcome to HappyHelper

## How We Use Claude

Based on Claude's usage over the last 30 days:

Work Type Breakdown:
  Build Feature  ████████████████████  100%

Top Skills & Commands:
  /skill-doctor  ████░░░░░░░░░░░░░░░░  1x/month

Top MCP Servers:
  Render              ████████████████████  61 calls
  claude-code-remote  ██░░░░░░░░░░░░░░░░░░   7 calls

## Your Setup Checklist

### Codebases
- [ ] happyhelper — main Django interview-prep app (primary repo)
- [ ] morluto — sibling project
- [ ] parakeetai — sibling project

### MCP Servers to Activate
- [ ] Render — deploy, tail logs, trigger deploys, and manage services on Render.com. Get access via the Render MCP integration in Claude Code settings (requires a Render account with access to the team workspace).
- [ ] claude-code-remote — spawn and communicate with remote Claude Code sessions for parallel work. Available automatically in Claude Code; no separate setup needed.

### Skills to Know About
- `/skill-doctor` — audits which skills are loaded in your session, flags ones that add to the system prompt but were never used, and tells you how to disable them. Run it periodically to keep your context lean.

## Team Tips

- The app deploys automatically to Render on every push to `main` — use the Render MCP server to tail logs and confirm a deploy landed before closing a task.
- Run `/skill-doctor` at the start of a new session to keep your system prompt lean; disable plugins you don't need in `/plugin`.

## Get Started

Pick up any open issue in the `happyhelper` repo, or ask Claude to run a `/code-review` on the current diff to get familiar with the codebase.

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
