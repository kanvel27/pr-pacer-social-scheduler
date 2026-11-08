# PR Pacer free hosted refill

Prepared locally; not deployed or connected yet. The existing local Codex refill remains the fallback until a hosted run has been verified.

This worker schedules only existing, approved Buffer drafts. Its dated plan covers 50 TikTok drafts (November 20–January 8 at 6 PM America/Chicago) and eleven Instagram drafts (December 21–31 at 10 AM). It excludes every date owned by Metricool. It never creates a post, retries a failed publication, changes slide order, or publishes a missed post as catch-up content.

Proposed destination: a dedicated public repository, `kanvel27/pr-pacer-social-scheduler`. Only this worker, its synthetic automated tests, the workflow, and the public promotional captions/dates would be uploaded. No app source, user records, account email, or credentials belong in repository files. A new PR Pacer Buffer API key would be stored only in GitHub's encrypted repository secret `BUFFER_API_KEY`.

The workflow uses a standard public-repository Ubuntu runner, which GitHub documents as free. It does not use paid services, artifacts, caches, or a private-repository runner allowance. It runs twice daily, serially, at 13:17 and 19:17 UTC. The fixed publication dates are in Central time. The campaign stops adding posts after January 8. GitHub scheduled runs can be delayed; Buffer holds the next ten accepted posts per channel in advance.

Ten synthetic operational tests currently pass. Actual authenticated API validation is pending creation of the owner-approved key. The first authenticated run must be read-only (`node refill.mjs`), verify the dedicated account/channels and all draft matches, then qualify `--apply` with its subsequent provider readback. Existing queues are full today, so the initial real run may legitimately schedule nothing. This is not evidence that a future post has published.

## Deployment after credential approval

1. Create the dedicated public repository and upload only this directory.
2. Generate the key in the dedicated Buffer account and transfer it directly to the encrypted repository secret, without printing or committing it.
3. Run the read-only verification and inspect results before enabling the apply schedule.
4. Trigger one hosted run, verify account identity, queue limits and exact accepted dates.
5. Replace the local refill only after the hosted dependency has been verified. Preserve provider incidents as actionable failures; never auto-retry an uncertain TikTok publication.
