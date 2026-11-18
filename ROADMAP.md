# Roadmap

Ideas not built yet, roughly in priority order.

## Git as a safety net

The plugin's hooks are the main mechanism, because they run while the agent works and talk to the agent directly. Git covers what hooks can't see: hand edits between sessions, other tools, merges.

- **`claimkeeper init --git-hook`**: install a pre-commit hook that runs `claimkeeper check --ci` and blocks commits with unresolved claim issues (skippable with `--no-verify`, like any hook).
- **Rename detection from git**: for `file_not_found`, ask git (`git diff -M` / `git log --follow`) where the file went, before falling back to name/size/wording search.
- **Old wording from history**: for a stale place, show what it said at the earlier claim revision (`git show <commit>:<path>`), so the agent sees the exact old text next to the new meaning.

## Other

- Plugin icon (`.claude-plugin/icon.png`, 512–2048 px square) for the plugin directory listing.
- Publish to npm so `npx claimkeeper` works without a checkout.
- Remotion helper: list a composition's imported assets automatically as `output record` inputs.
- Optional transcript check for audio: compare a speech-to-text transcript of generated audio with its script.
- Locking for parallel sessions writing the same claim.
