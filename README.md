# Semantic Release Action

A GitHub Action to create versioned GitHub releases with automatically generated release notes. Choose a major, minor, or patch version bump, use pull request labels to decide the bump, or promote a prerelease to a stable release.

## Basic Example

Create a stable patch release when changes are pushed to `main`:

```yaml
name: 'Create Release'

on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: benwoo1110/semantic-release-action@v1
        id: release
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          release_mode: release
          version_bump: patch

      - name: Use release outputs
        if: steps.release.outputs.release_created == 'true'
        env:
          TAG_NAME: ${{ steps.release.outputs.tag_name }}
          PUBLISH_VERSION: ${{ steps.release.outputs.publish_version }}
        run: |
          echo "Created release $TAG_NAME"
          echo "Build version: $PUBLISH_VERSION"
```

The target repository must already have a version tag, such as `1.0.0`. The action determines the next version from the highest version among the first 100 tags returned by GitHub, including prereleases. Use tags in the form `1.2.3`, `1.2.3-pre`, or `1.2.3-pre.1`, without a `v` prefix.

The action uses the GitHub API, so a checkout step is only needed if other steps in your workflow require repository files. New release tags target the repository's default branch.

## Options

| Option | Required? | Description |
| --- | --- | --- |
| `github_token` | Yes | GitHub token used to create releases. Use `${{ secrets.GITHUB_TOKEN }}` with `contents: write`, or a secret containing a token with access to the target repository. |
| `repo_owner` | No | Owner of the target repository. Defaults to the owner of the repository running the workflow. |
| `repo_name` | No | Name of the target repository. Defaults to the repository running the workflow. |
| `version_bump` | For `release` and `prerelease` | Version bump strategy: `major`, `minor`, `patch`, `prlabel`, or `norelease`. Has no default and is ignored in `promote` mode. |
| `release_mode` | No | Release mode: `release`, `prerelease`, or `promote`. Defaults to `prerelease`. |
| `promote_from` | No | Prerelease tag to promote, such as `1.2.3-pre.1`. Only valid in `promote` mode. If omitted, the highest prerelease version is selected. |

Keep tokens in GitHub Secrets. When targeting another repository, provide a token with permission to create releases in that repository; the workflow's `GITHUB_TOKEN` is scoped to its own repository.

## Release Modes

### Stable Release

Set `release_mode: release` and choose a `version_bump`:

```yaml
- uses: benwoo1110/semantic-release-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    release_mode: release
    version_bump: minor
```

Starting from `1.2.3`, this creates `1.3.0`. When starting from a prerelease, the action removes the prerelease suffix if its version already meets the requested bump level; otherwise, it bumps the version first.

### Prerelease

```yaml
- uses: benwoo1110/semantic-release-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    release_mode: prerelease
    version_bump: patch
```

Starting from `1.2.3`, this creates `1.2.4-pre`. Repeating the same bump creates `1.2.4-pre.1`, then `1.2.4-pre.2`. Its `publish_version` output is `1.2.4-SNAPSHOT`.

### Promote a Prerelease

```yaml
- uses: benwoo1110/semantic-release-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    release_mode: promote
    promote_from: '1.2.4-pre.2'
```

This creates a new stable release named `1.2.4`, leaving the existing prerelease in place. The selected tag must have an existing GitHub release marked as a prerelease. Omit `promote_from` to select the highest prerelease version automatically. The new release uses the default branch and newly generated release notes, rather than copying the prerelease's commit or notes.

## Pull Request Labels

Set `version_bump: prlabel` to determine the version bump from the first pull request associated with the workflow's commit. Add `pull-requests: read` to the workflow permissions:

```yaml
permissions:
  contents: write
  pull-requests: read
```

Use the following step in a workflow triggered by pushes to your release branch after merging pull requests:

```yaml
- uses: benwoo1110/semantic-release-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    release_mode: release
    version_bump: prlabel
```

| Label | Version bump |
| --- | --- |
| `release:major` | Major, such as `1.2.3` → `2.0.0`. |
| `release:minor` | Minor, such as `1.2.3` → `1.3.0`. |
| `release:patch` | Patch, such as `1.2.3` → `1.2.4`. |

Exactly one of these labels must be present. If no associated pull request is found, or it has zero or multiple release labels, the action skips release creation and sets `release_created` to `false`. Set `version_bump: norelease` to explicitly skip creating a release in `release` or `prerelease` mode.

## Outputs

| Output | Description |
| --- | --- |
| `release_created` | `true` when a release was created; `false` when release creation was skipped. |
| `tag_name` | Created release tag, such as `1.2.3` or `1.2.3-pre.1`. |
| `prerelease` | `true` for a prerelease; `false` for a stable release. |
| `body` | Automatically generated release notes. |
| `publish_version` | Build version: `1.2.3` for a stable release or `1.2.3-SNAPSHOT` for a prerelease. |
| `release_type` | `beta` for a prerelease or `release` for a stable release. |

Access outputs using the step's `id`, for example `${{ steps.release.outputs.publish_version }}`. Outputs other than `release_created` are only set when a release is created. GitHub Actions exposes step outputs as strings, so compare `release_created` with `'true'` before running dependent steps.
