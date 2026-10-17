# dsh-add-to-chat

Select chat text and add it to the composer as an annotation.

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin,
packaged as a DSH bundle: `package.json` declares `dsh.bundle.patch`, and
`cordis.patch.yml` inserts the `add-to-chat` row into the active profile.
The client half is served from `lib/client.js` (`dsh.client.platform: web`).

## Install

- Desktop app: **Plugins** → install `github:bosenok/dsh-add-to-chat` (private repository:
  give the machine git access), then enable the bundle.
- CLI: `dsh plugin --profile <profile> add github:bosenok/dsh-add-to-chat`.
- Local checkout: `dsh plugin --profile <profile> add file:/path/to/dsh-add-to-chat`.

Enabling the bundle mounts the plugin; HMR applies it to a running app, and a
restart makes sure the client half is rebuilt.

## Development

`lib/` is built and committed; the sources live in `src/`. Rebuild the client with
the repository's Vite config (`npx vite build` → `dist/`, then the wrapper in
`build/wrapper.js` produces `lib/client.js`).

## License

MIT — see [LICENSE](LICENSE). Third-party code bundled into `lib/` and its
licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
