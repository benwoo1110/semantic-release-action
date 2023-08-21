import core from '@actions/core'
import github from '@actions/github'
import { LatestRelease, ListAssociatedPullRequests, ListReleases, latestRelease, listAssociatedPullRequests, listReleases } from './endpoints.js'

interface Inputs {
    githubToken: string
    repoOwner: string
    repoName: string
    versionBumpMode: string
    prerelease: boolean
}

interface Release {
    tag_name: string
    prerelease: boolean
    draft: boolean
} 

interface Version {
    major: number
    minor: number
    patch: number
    prerelease: number
}

enum VersionBumpMode {
    prlabel,
    norelease,
    major,
    minor,
    patch,
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
}

const octokit = github.getOctokit(inputs.githubToken)
const owner = inputs.repoOwner === '' ? github.context.repo.owner : inputs.repoOwner
const repo = inputs.repoName === '' ? github.context.repo.repo : inputs.repoName
const versionBumpMode: VersionBumpMode = VersionBumpMode[inputs.versionBumpMode.toLowerCase() as keyof typeof VersionBumpMode]

main().catch(err => {
    console.error(err)
    core.setFailed(err.message)
})

async function main() {
    if (versionBumpMode === undefined) {
        core.error(`Unknown version bump mode: ${inputs.versionBumpMode}`)
        core.error('Version bump mode must be one of: prlabel, norelease, major, minor, patch')
        core.setFailed('Invalid version bump mode')
        return
    }
    
    const versionBumpAction = await getVersionBumpAction()
    core.info(`Version bump action: ${versionBumpAction}`)
    createRelease(versionBumpAction)
}

async function getVersionBumpAction(): Promise<VersionBumpAction> {
    if (versionBumpMode === VersionBumpMode.norelease) {
        core.info('No release will be created.')
        return VersionBumpAction.None
    }
    else if (versionBumpMode === VersionBumpMode.prlabel) {
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
    else if (versionBumpMode === VersionBumpMode.major) {
        return VersionBumpAction.Major
    }
    else if (versionBumpMode === VersionBumpMode.minor) {
        return VersionBumpAction.Minor
    }
    else if (versionBumpMode === VersionBumpMode.patch) {
        return VersionBumpAction.Patch
    }
    else {
        core.error(`Unhandled version bump mode: ${versionBumpMode}`)
        return VersionBumpAction.None
    }
}

async function createRelease(versionBumpAction: VersionBumpAction) {
    if (versionBumpAction === VersionBumpAction.None) {
        core.info('No release will be created.')
        return
    }

    const latestRelease: Release | undefined = await getLatestRelease()
    const latestPrerelease: Release | undefined = await getLatestPrerelease()

    const latestReleaseTag = tagToVersion(await getLatestReleaseTag(latestRelease))
    const latestPrereleaseTag = tagToVersion(await getLatestPrereleaseTag(latestPrerelease))

    core.info(`Latest release: ${JSON.stringify(latestReleaseTag)}`)
    core.info(`Latest prerelease: ${JSON.stringify(latestPrereleaseTag)}`)
}

async function getLatestRelease() {
    const release: LatestRelease["response"] = await octokit.request(latestRelease, {
        owner,
        repo,
    })
    return release.data
}

async function getLatestPrerelease() {
    const releases: ListReleases["response"] = await octokit.request(listReleases, {
        owner,
        repo,
    })
    return releases.data.find((release) => release.prerelease && !release.draft)
}

function getLatestReleaseTag(latestRelease: Release | undefined): string {
    if (latestRelease === undefined) {
        return '0.0.0'
    }
    return latestRelease.tag_name
}

function getLatestPrereleaseTag(latestPrerelease: Release | undefined): string {
    if (latestPrerelease === undefined) {
        return '0.0.0-pre'
    }
    return latestPrerelease.tag_name
}

function tagToVersion(tag: string): Version {
    // release format: <major>.<minor>.<patch>
    // prerelease format: <major>.<minor>.<patch>-pre.<prerelease>
    const [versionpart, prepart] = tag.split('-')
    const [major, minor, patch] = versionpart.split('.').map((v) => parseInt(v))
    if (prepart === undefined) {
        return {
            major,
            minor,
            patch,
            prerelease: -1,
        }
    }
    const [_, prerelease] = prepart.split('.')
    return {
        major,
        minor,
        patch,
        prerelease: parseInt(prerelease),
    }
}
