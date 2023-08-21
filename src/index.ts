import core from '@actions/core'
import github from '@actions/github'
import { ListAssociatedPullRequests, listAssociatedPullRequests } from './endpoints.js'

interface Inputs {
    githubToken: string
    repoOwner: string
    repoName: string
    versionBumpMode: string
    prerelease: boolean
    tagPrefix: string
}

enum VersionBumpMode {
    Major = 'major',
    Minor = 'minor',
    Patch = 'patch',
    PRLabel = 'prlabel',
    NoRelease = 'norelease',
}

enum VersionBumpAction {
    Major,
    Minor,
    Patch,
    None,
}

const inputs: Inputs = {
    githubToken: core.getInput('github_token', { required: true }),
    repoOwner: core.getInput('repo_owner', ),
    repoName: core.getInput('repo_name'),
    versionBumpMode: core.getInput('version_bump_mode'),
    prerelease: core.getBooleanInput('prerelease'),
    tagPrefix: core.getInput('tag_prefix'),
}

const octokit = github.getOctokit(inputs.githubToken)
const owner = inputs.repoOwner === '' ? github.context.repo.owner : inputs.repoOwner
const repo = inputs.repoName === '' ? github.context.repo.repo : inputs.repoName
const versionBumpMode: VersionBumpMode = VersionBumpMode[inputs.versionBumpMode as keyof typeof VersionBumpMode]

main().catch(err => {
    console.error(err)
    core.setFailed(err.message)
})

async function main() {
    const versionBumpAction = await getVersionBumpAction()
    if (versionBumpAction === VersionBumpAction.None) {
        core.info('No release will be created.')
        return
    }
    core.info(`Version bump action: ${versionBumpAction}`)
}

async function getVersionBumpAction(): Promise<VersionBumpAction> {
    if (versionBumpMode === VersionBumpMode.NoRelease) {
        core.info('No release will be created.')
        return VersionBumpAction.None
    }
    else if (versionBumpMode === VersionBumpMode.PRLabel) {
        const associatedPrs: ListAssociatedPullRequests["response"] = await octokit.request(listAssociatedPullRequests, {
            owner,
            repo,
            commit_sha: github.context.sha,
        })
        if (associatedPrs.data.length === 0) {
            core.error('No PRs associated with this commit.')
            return VersionBumpAction.None
        }
        const targetPr = associatedPrs.data[0]
        const versionBumpActions: VersionBumpAction[] = targetPr.labels.map(label => label.name).map((label) => {
            if (label === 'release:major') {
                return VersionBumpAction.Major
            } else if (label === 'release:minor') {
                return VersionBumpAction.Minor
            } else if (label === 'release:patch') {
                return VersionBumpAction.Patch
            }
            return VersionBumpAction.None
        }).filter((label) => label !== VersionBumpAction.None)

        if (versionBumpActions.length === 0) {
            core.error('No release labels found on the PR.')
            return VersionBumpAction.None
        }
        if (versionBumpActions.length > 1) {
            core.error('Multiple release labels found on the PR.')
            return VersionBumpAction.None
        }

        return versionBumpActions[0]
    }
    else if (versionBumpMode === VersionBumpMode.Major) {
        return VersionBumpAction.Major
    }
    else if (versionBumpMode === VersionBumpMode.Minor) {
        return VersionBumpAction.Minor
    }
    else if (versionBumpMode === VersionBumpMode.Patch) {
        return VersionBumpAction.Patch
    }
    else {
        core.error(`Unknown version bump mode: ${versionBumpMode}`)
        return VersionBumpAction.None
    }
}
