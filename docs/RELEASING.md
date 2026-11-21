# Releasing Coastline

Releases are made by the fleet's release automation. The arcade is separate:
every push to `main` keeps deploying `web/` to
https://coastline.play.danielstephenson.dev, whether or not a release is cut.

## Versions and tags

- The version lives in `package.json` (`"version"`). It is the only version file.
- The arcade deploy reports `<package.json version>+g<short sha>`.
- Tags are the bare version, `X.Y.Z` (for example `0.1.0`), annotated, on a
  commit of `main` whose `package.json` holds that version.

## What a tag builds

Pushing a tag runs `.github/workflows/release.yml`. It checks that
`package.json` matches the tag, runs the unit tests (`npm test`), builds
`coastline-<version>-web.zip` with `tools/build-release.sh` (the `web/` folder
the arcade serves, inside `coastline-<version>-web/`, plus a `version.txt`),
writes `coastline-<version>-web.zip.sha256` (`sha256sum` format), creates the
GitHub release if it does not exist and uploads both files.

Running the workflow by hand with no tag is a dry run: it builds and checks
the zip at the selected commit and keeps it as a workflow artifact, attaching
nothing.

## Saves

The game keeps three `localStorage` keys:

- `coastline.v1`: progress, `{"reached": <scene>, "done": <bool>}`, read by
  `parseSave` in `web/lessons.js`, which also holds `SAVE_VERSION`.
- `coastline.v1.previous`: the progress that `?new` (`--new`) kept aside, in
  the same format.
- `coastline.muted`: `"1"` when the sound is off, read by `parseMuted`.

`tests/fixtures/saves/v<N>-<name>.json` map each key to the exact string the
game stored. The current ones were dumped from `localStorage` while the game
was played in headless Chromium. `tests/saves.test.cjs` names every fixture,
fails on any file it does not name, and loads each through `parseSave` and
`parseMuted`.

Once a version is released its fixtures never change. When a stored format
changes, bump `SAVE_VERSION`, migrate the older format on load, and add new
`v<N>-*.json` fixtures next to the old ones.
