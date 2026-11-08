# PR Pacer free hosted refill

Active at https://github.com/kanvel27/pr-pacer-social-scheduler . The initial hosted run succeeded on November 8, 2026 and scheduled five real, approved Instagram carousels for December 21–25, preserving all six ordered images, captions and automatic publishing. Provider readback independently confirmed those dates.

This worker schedules only existing, approved Buffer drafts. Its dated plan covers 50 TikTok drafts (November 20–January 8 at 6 PM America/Chicago) and eleven Instagram drafts (December 21–31 at 10 AM). It excludes every date owned by Metricool. It never creates a post, retries a failed publication, changes slide order, or publishes a missed post as catch-up content.

The public repository contains only this worker, its explicitly synthetic automated tests, workflow, and public promotional captions/dates with provider post/media identifiers. No app source, user records, account email, or credentials belong in repository files. The owner-approved PR Pacer Buffer key is stored in GitHub's encrypted repository secret `BUFFER_API_KEY`. It has only `account:read`, `posts:read` and `posts:write`; it expires February 6, 2027.

The workflow uses a standard public-repository Ubuntu runner, which GitHub documents as free. It does not use paid services, artifacts, caches, or a private-repository runner allowance. It runs twice daily, serially, at 13:17 and 19:17 UTC (7:17 AM and 1:17 PM Central during this campaign). The fixed publication dates are in Central time. The campaign stops adding posts after January 8 and checks final delivery states through January 10. GitHub scheduled runs can be delayed; Buffer holds the next ten accepted posts per channel in advance.

Thirteen synthetic operational tests pass. Real qualification includes authenticated account/channel/draft reads, preserving five existing Instagram posts during migration to Metricool, a full TikTok payload accepted on an existing approved draft (which remained a draft), and the hosted scheduling/readback of five real Instagram posts. A scheduled queue entry is not evidence that a future post has published.

## Maintenance state

All sixty-one refill entries are pinned to existing draft/post IDs and ordered media URLs. All sixty second-month platform posts are uploaded and reconciled against the approved captions and ordered image packs. Twenty-nine topics use six slides; the weight-and-pace topic uses seven. Every post ends with the PR Pacer download slide. Preparation status is printed on every run. A missing future draft is never silently recreated by this worker.

The owner-facing local receipt lives outside this public repository. This hosted worker replaces the old local refill. Provider errors and uncertain TikTok results require native-profile verification before any retry. Delivery checks cover both entire campaign queues, including the initial ten TikTok posts that are outside the refill plan.

## Commands

- `node --test refill.test.mjs`: synthetic safeguards only.
- `BUFFER_API_KEY=... node refill.mjs`: authenticated read-only verification; keep secrets out of shell history and logs.
- `BUFFER_API_KEY=... node refill.mjs --apply`: schedule matching approved existing drafts into available free queue slots, then read back exact dates, captions and media order.
