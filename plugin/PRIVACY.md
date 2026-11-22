# Privacy policy

claimkeeper runs on your machine and keeps everything there.

- **No network.** It makes no network requests: no telemetry, no analytics, no crash reports, no external services, no accounts. It never fetches the web pages you track; it only reminds you to check them by hand.
- **No data leaves the project.** Claims and the places they appear (short wording snippets, at most 500 characters each) are stored in the project's `.claims/` folder. Personal settings, session state and the activity log are in the git-ignored `.claims/local/`. Whether `.claims/` is committed to your repository is your choice (`init --private` keeps it out of git).
- **No secrets.** It refuses to store anything that looks like an API key, token, private key or credential, and never tracks `.env*`, key files or `secrets/` folders.
- **No authentication and no rate limits to configure.** The MCP server talks to the agent over standard input and output only; it opens no port and accepts no remote connections.
- **The agent sees what you let it see.** claimkeeper returns claim text and file wording to the coding agent that called it, so that agent's own provider handles that text under its own privacy policy. claimkeeper itself sends it nowhere.
- **Debug log.** Only if you set `CLAIMKEEPER_DEBUG`, a local log of hook events is written to the file you name, with file contents, edits and command output redacted.

To remove everything claimkeeper stored, delete the `.claims/` folder (and, if you installed it, the claimkeeper block in `.git/hooks/pre-commit` with `claimkeeper uninstall-git-hook`).

Questions: open an issue at https://github.com/md-abid-hussain/claimkeeper/issues.
