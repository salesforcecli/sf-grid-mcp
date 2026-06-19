# Contributing to `@salesforce/sf-grid-mcp`

Thanks for your interest. This project is **Salesforce-sponsored**: external contributions are welcome, but Salesforce employees retain final review authority on what merges and ships.

## Governance

- Maintainers approve and merge pull requests.
- Releases to npm are gated by Salesforce's open-source release process; community contributors should not expect to publish.
- Bugs, feature requests, and questions are tracked via GitHub Issues on this repo.

## Filing issues

Use [GitHub Issues](https://github.com/salesforcecli/sf-grid-mcp/issues). Before opening a new one, search existing issues to avoid duplicates.

A good bug report includes:

- The MCP client you're using (Claude Code, Cursor, VS Code Copilot, etc.) and its version.
- Your `sf --version` output.
- Node version (`node --version`); we require Node 18+.
- Exact MCP client config for the server (with secrets redacted).
- The tool call you made and the error message — `--debug` output is gold.
- The Salesforce org type (scratch / sandbox / production) and API version if non-default.

For feature requests, describe the user-facing behavior and the workflow it would unblock. We reserve the right to decline requests that don't align with the Grid Connect API surface this server wraps.

## Local development

```bash
git clone https://github.com/salesforcecli/sf-grid-mcp.git
cd sf-grid-mcp
npm install
npm run build      # tsc → dist/
npm run dev        # watch mode
npm test           # unit tests (offline, vitest)
```

To run integration evals against a real org you've already authenticated with `sf`:

```bash
npm run evals      # see evals/README.md for setup
```

Point your MCP client at the local build to dogfood your changes:

```json
{
  "mcpServers": {
    "sf-grid-local": {
      "command": "node",
      "args": ["/absolute/path/to/sf-grid-mcp/dist/index.js", "--orgs", "DEFAULT_TARGET_ORG"]
    }
  }
}
```

## Pull requests

1. Fork the repo and create a topic branch.
2. Keep PRs focused — one logical change per PR is much easier to review.
3. Add or update tests. The unit suite (`npm test`) must pass.
4. Run `npm run build` before pushing; we don't ship type errors.
5. Open a PR against `main` and link any related issues.
6. Sign the [Salesforce CLA](https://cla.salesforce.com/sign-cla) once — the bot will prompt you on your first PR.
7. A maintainer will review. Expect comments; iterate on the same branch.

We follow [Conventional Commits](https://www.conventionalcommits.org/) loosely — a clear imperative subject line is enough.

## Release process

Versioning follows [SemVer](https://semver.org). Maintainers cut releases by:

1. Updating `CHANGELOG.md` with the new version's notes.
2. Bumping `version` in `package.json`.
3. Tagging `vX.Y.Z` and pushing to `main`.
4. Publishing through Salesforce's gated npm release tooling.

Community contributors do not need to worry about the publish step.

## Code of Conduct

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Contributions are licensed under [Apache-2.0](LICENSE.txt) and the [Salesforce CLA](https://cla.salesforce.com/sign-cla).
