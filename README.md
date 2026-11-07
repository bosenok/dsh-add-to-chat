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

> Note for the app-managed `desktop` profile: `dsh plugin --profile desktop add`
> only installs the dependency and copies the package; unlike a regular profile
> it does not enable the bundle. Enable it by adding the package name to
> `dsh.profile.bundles` in `~/.dsh/profiles/desktop/package.json` (or through the
> Plugins page). Other profiles enable the installed bundle automatically.


## Versioning

This project follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).
Releases are tagged in git (`v0.1.0` and later `v0.1.x` tags), announced
as GitHub releases and documented in [CHANGELOG.md](./CHANGELOG.md).

`engines.dsh` in `package.json` pins the compatible DSH range.

Bump policy: **patch** — fixes; **minor** — new features without breaking the
configuration; **major** — breaking changes to the configuration, the session
format or the supported DSH range.

`CHANGELOG.md` is generated with [git-cliff](https://git-cliff.org/) from
[Conventional Commits](https://www.conventionalcommits.org/) (`cliff.toml`):

```sh
./scripts/changelog.sh                 # print unreleased notes
./scripts/changelog.sh v0.2.0          # add the next release section
git cliff -o CHANGELOG.md              # full regeneration (curated history is kept otherwise)
```

**Cutting a release.** Use the guarded helper instead of hand-cutting one:

```sh
./scripts/release.sh patch              # or minor / major / an explicit x.y.z
./scripts/release.sh patch --dry-run    # print the plan, change nothing
```

It refuses a dirty tree or a branch other than `develop`, a target that is not
strictly newer than every existing tag, an existing tag (local or origin) or
GitHub release, then bumps `package.json`, prepends the CHANGELOG with
git-cliff, runs Git Flow, pushes `master`/`develop`/tags and creates the GitHub
release. The committable hooks (`.githooks/commit-msg`, `.githooks/pre-push`,
installed by `./scripts/gitflow-setup.sh`) reject a `chore(release): vX` commit
whose version already exists or does not match `package.json`, and refuse to
move a published tag or push a backwards version.

To install a specific release instead of a moving branch, pin the tag:

```sh
dsh plugin --profile desktop add "git+ssh://git@github.com/bosenok/dsh-add-to-chat.git#v0.1.0"
```

Tags are created on `master` by Git Flow; integration builds live on `develop`
(install with `#develop` if you want the latest unreleased code).

## Development

`lib/` is built and committed; the sources live in `src/`. Rebuild the client with
the repository's Vite config (`npx vite build` → `dist/`, then the wrapper in
`build/wrapper.js` produces `lib/client.js`).

## License

MIT — see [LICENSE](LICENSE). Third-party code bundled into `lib/` and its
licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Git Flow

Development follows [Git Flow](https://github.com/git-flow/git-flow-next) via the
committable `.gitflow` configuration. In a fresh clone activate it once:

```sh
./scripts/gitflow-setup.sh
```

(The script runs `git flow config sync` and creates the local `master`/`develop`
branches. `git flow config sync` alone is enough if both base branches already
exist.)

| Branch | Purpose |
|---|---|
| `master` | released code only; every commit here is tagged `vX.Y.Z` |
| `develop` | integration branch (repository default branch) |
| `feature/*` | one change, started from and finished into `develop` |
| `release/*` | stabilization, started from `develop`, finished into `master` + `develop` |
| `hotfix/*` | urgent production fix, started from `master`, finished into both |

```sh
git flow feature start my-change
# ... conventional commits: feat: …, fix: …, docs: …, chore: …
git flow feature finish my-change

git flow release start 0.2.0
# bump the version; update CHANGELOG.md (see Versioning)
git add -A && git commit -m "chore(release): v0.2.0"
git flow release finish 0.2.0        # merges to master + develop, creates the tag
git push origin master develop --tags
```
