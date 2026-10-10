# Signed-in UI audit

Design review of everything behind the login, 10 October 2026. Scope: how the screens look and read, and whether every feature that exists can be found on a screen. No feature was added or removed. Missing features are listed in section 3 and left for later.

How it was checked: every signed-in page in dark and light at 1440, 820 and 390 px wide (156 page states), plus 16 live-session states that only appear once a session is running (answers on screen, line selection, bionic reading, focus mode, floating answer window, folded panels, ratings, meeting panel, calendar, summary, prompt menus), again in both themes and three widths. Each state was screenshotted and run through an automated check for contrast, text size, control size, labels and keyboard focus.

Result after the fixes below: 0 contrast failures, 0 text under 12 px, 0 unlabelled controls, every keyboard stop has a visible focus ring. Two native checkboxes on Settings and the template form are 13 to 18 px on a phone; they sit inside larger labels, so they are tappable. 32 of 32 tests pass.

## 1. What changed in this pass

All in `interview/templates/interview/live_session.html` and `_icon.html`. Presentation only.

| Area | Before | Now |
|---|---|---|
| Speaker labels | New lines said `INTERVIEWER` / `YOU` in capitals with a dashed underline; lines loaded from the server said `Interviewer` / `You` | One style everywhere: sentence case, underline only on hover |
| Line layout | Tone emoji floated in the middle of the row | Name and tone together on the left, time on the right |
| Line actions | Yellow boxed buttons with emoji appeared under the line on hover and pushed the transcript down | A small floating toolbar on the corner of the line: Ask, Select, Edit, Delete. Nothing moves |
| Selecting lines | Tick box hung off the left edge; selected lines were yellow in the light theme while the action bar was purple | Tick box inside the bubble; selection uses the accent of the theme |
| Transcript read-out | `21w | 21 wpm | would · differentl… | you 67%` wrapped onto two lines; showed `0w | — | |` when empty | `21 words  21 wpm  You 67%` on one line; hidden until there is a transcript; gives way before the toolbar when the panel is narrow |
| Answer footer | `12w · 4s read`, an unlabelled `low` chip, 👍 👎 🔖 📋 🔊 | `12 words · 4s read`, `Confidence: low` with a status dot, line icons for helpful / not helpful / bookmark, and plain labels: Copy, Copy Q&A, Read aloud |
| Question line | New answers started with `Q: `, saved ones did not | No prefix on either |
| Folded answers | 50% opacity, failed contrast (2.5:1) | Full-strength text on a quieter surface |
| Bionic reading | Turning it on replaced the formatted answer with raw Markdown (`**bold**`, table pipes, code fences) | Emphasis is laid over the formatted answer. Headings, lists and tables stay; code is left as written |
| Bionic control | `B` button with no state; status said `Bionic off` / `Bionic ON` | Button fills when on and reports its state to screen readers; status reads `Bionic reading on/off` |
| Opacity slider | Unlabelled slider in the title bar; pushed the title onto two lines in the floating window | Labelled `Opacity`, in the status row. Shown only when the panel floats, which is the only time it has an effect |
| Focus mode | A pill reading "Press F to exit" sat on top of the toolbar; no way out with a mouse | A slim strip above the panels with an Exit button |
| Messages (toasts) | Appeared over the answer panel controls | Appear over the top bar, clear of the controls and the answer button |
| Meeting summary | Ran underneath the note bar and the answer bar and scrolled the title bar off the screen | Scrolls inside its own box; the bars stay put |
| Floating answer window | A stray 5 px bar was left at the bottom-left of the page | Gone |
| Quick questions | Square boxes, lower-case labels | Pills, sentence case |
| Meeting helper | Role tab was dark amber in the light theme; suggestions were in a different font; cut off the left edge of the screen on a phone | Uses the accent of the theme and the app font; opens as a sheet across the screen on a phone |
| Meeting participants | Name field collapsed to about 14 px at tablet width | Keeps a 110 px minimum and wraps |
| Insight and template menus | Selected item was mustard in the light theme | Accent tint of the theme |
| Phone tabs | Active tab brown on beige in the light theme | Text colour with an accent underline |
| Small things | `▾` glyphs, an unlabelled interval dropdown, 12 px edit field | Chevron icons, labelled dropdown, edit field matches the line it edits |

One visible change to be aware of: the opacity slider no longer shows while the answer panel is docked. Docked, it changed nothing on screen.

## 2. Feature inventory

Every feature found in the code and where a signed-in user reaches it.

**Top bar (all pages):** Sessions, Templates, New session, theme switch, account menu (Profile, Settings, Plans and billing, Sign out).

**Sessions:** card view and table view; search by title or company; filter by All / Not started / Live / Ended; Start, Resume, Review, Delete; activity totals; Free-plan usage bar with upgrade prompt; desktop overlay downloads.

**New session:** Interview or Meeting; six example fills; title, company, language (10), job description, background; meeting agenda; conversation plan builder (beta).

**Live session**

- Session bar: status, timer, Quick questions, focus mode, keyboard shortcuts, Auto answer switch, End session.
- Transcript: text size, search, copy, export to Markdown, clear, select lines and ask about them, line count, hide panel, words / pace / keywords / talk-share read-out, jump-to-latest badge.
- Per line: rename speaker, tone marker, time, Ask, Select, Edit, Delete, assign a meeting participant's voice.
- Answers: streaming answer, regenerate, copy, read aloud, copy all Q&A, clear, bionic reading, text size, pop out to a floating window, opacity, collapse to a bubble, drag to resize, fold an answer, helpful / not helpful, bookmark, copy Q&A, word count, read time, confidence estimate.
- Bottom bar: microphone, transcribe interval, conversation insights with a type menu, meeting helper with role tabs, question box, Get answer with a template menu and a default template, Clear, Save to transcript, notes.
- Meetings only: participants, scan names from the screen, who is speaking, meeting prompts, past meetings with the same company, calendar panel, summary, expand panel.
- Phone: Transcript and Suggested answer tabs.

**Review:** totals, full transcript, saved answers with formatting, copy, export as text or Markdown, edit details, delete.

**Templates:** list, filter by type, search, add, edit, delete, switch on or off, order, emoji icon.

**Profile:** overlay token (copy, regenerate), name and email, display name, role, company, theme, default background.

**Settings:** theme, Groq key, answer and transcription models, OpenRouter key and model.

**Plans and billing:** plan comparison, checkout, success and unavailable pages.

## 3. Missing from the UI

Not built. Listed for a later decision.

### A. Works on the server, has no screen

| # | Feature | Where it lives | What is missing |
|---|---|---|---|
| A1 | Session scoring: overall, communication, clarity and engagement scores with feedback | `api/session/<id>/score/` | No button, no score card on the review page |
| A2 | Account statistics | `api/stats/` | Used by nothing; the dashboard totals are computed separately |
| A3 | Onboarding page | `/onboarding/` | Nothing links to it and sign-up does not send new users there |
| A4 | Manage or cancel a subscription | `/billing/portal/` | Reachable only from the pricing page; not in the account menu or on Profile |
| A5 | Database sync screen for staff | `/admin-portal/db-sync/` | No link anywhere; staff must type the address |
| A6 | Django admin and the task board | `/admin/` | No link for staff; unstyled |
| A7 | Meeting agenda and conversation plan | Saved with the session | Entered on New session, never shown during the session or on the review page |
| A8 | Audio recordings | Saved under `recordings/<session id>/` | No playback, download or delete |

### B. Works on screen, is not saved

These look like they persist and do not. Each is gone after a page reload.

| # | Feature | Detail |
|---|---|---|
| B1 | Helpful / not helpful ratings | Held in the page only |
| B2 | Bookmarked answers | Held in the page only; no bookmarks list |
| B3 | Editing a transcript line | Changes the text on screen, not the saved transcript |
| B4 | Deleting a transcript line | Same |
| B5 | Renaming a speaker | Stored in the browser, so it does not follow the user to another device or the review page |
| B6 | Meeting summary | Generated on request, shown once, not stored and not on the review page |
| B7 | Answer actions on saved answers | After a reload, saved answers offer Copy only; rating, bookmark, Copy Q&A and Read aloud appear only on answers produced since the page opened |

### C. Present but cannot work as shipped

| # | Feature | Why |
|---|---|---|
| C1 | Google Calendar connection | Needs `GOOGLE_CALENDAR_CLIENT_ID`, which nothing sets and Settings has no field for; the return address `/oauth/google-calendar/callback/` has no route |
| C2 | Outlook / Teams calendar | Same pattern |
| C3 | Line actions on touch screens | Ask, Select, Edit and Delete appear on hover, so they cannot be reached on a phone or tablet |
| C4 | Line selection on a phone | The Select button is hidden at phone width |

### D. Account basics users will look for

| # | Missing |
|---|---|
| D1 | Forgot password / reset by email |
| D2 | Change password while signed in |
| D3 | Email verification |
| D4 | Delete account and data |
| D5 | Sign in with Google or Microsoft |
| D6 | Usage or billing history; current plan and renewal date on Profile |

### E. Promised on the pricing page, not built

Free trial, annual billing, a different model per plan, 7-day history on Free. The Free limit is 5 sessions in total, while the page reads as 5 a month.

### F. Common in this product category, absent here

| # | Missing |
|---|---|
| F1 | A microphone and speaker check before a session starts |
| F2 | Practice mode with generated questions |
| F3 | Upload a resume or job description as a file (text paste only today) |
| F4 | Search inside transcripts across sessions (search covers title and company only) |
| F5 | Duplicate a session or start one from a previous one |
| F6 | Resume a session after it has ended |
| F7 | Duplicate, preview or restore a default template |
| F8 | Share a review page or export to PDF |
| F9 | First-run tour of the live workspace |
| F10 | Language choice for the interface (the language field sets transcription only) |

## 4. Design notes left as they are

Judgement calls, not defects.

- Template icons and tone markers are emoji. They are user content (templates) or part of a feature (tone), so they were kept.
- The confidence estimate is worked out from answer length and hedging words. A short, correct answer reads as "low". It now has a neutral dot instead of a warning colour, and a tooltip says how it is worked out. The calculation is unchanged.
- The `30s` chip beside the microphone is the transcribe interval. It has a tooltip but no visible label.
- Focus mode hides the session title, so that state has no page heading.
