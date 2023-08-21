import core from '@actions/core'
import github from '@actions/github'
import { LatestRelease, ListAssociatedPullRequests, ListReleases, latestRelease, listAssociatedPullRequests, listReleases } from './endpoints.js'

interface Inputs {
    githubToken: string
    repoOwner: string
    repoName: string
    versionBump: string
    releaseMode: string
    promoteFrom: string
}

interface Release {
    tag_name: string
    prerelease: boolean
    draft: boolean
}

class Version {
    major: number;
    minor: number;
    patch: number;
    prerelease: number;

    constructor(major: number, minor: number, patch: number, prerelease: number = Number.MAX_VALUE) {
        this.major = major
        this.minor = minor
        this.patch = patch
        this.prerelease = prerelease
    }

    isMajorRelease(): boolean {
        return this.minor === 0 && this.patch === 0
    }

    isMinorRelease(): boolean {
        return this.patch === 0
    }

    isPatchRelease(): boolean {
        return this.patch > 0
    }

    isPreRelease(): boolean {
        return this.prerelease < Number.MAX_VALUE
    }
    
    compare(other: Version): number {
        if (this.major > other.major) {
            return 1
        }
        else if (this.major < other.major) {
            return -1
        }
        if (this.minor > other.minor) {
            return 1
        }
        else if (this.minor < other.minor) {
            return -1
        }
        if (this.patch > other.patch) {
            return 1
        }
        else if (this.patch < other.patch) {
            return -1
        }
        if (this.prerelease > other.prerelease) {
            return 1
        }
        else if (this.prerelease < other.prerelease) {
            return -1
        }
        return 0
    }

    greaterThan(other: Version): boolean {
        return this.compare(other) > 0
    }

    lessThan(other: Version): boolean {
        return this.compare(other) < 0
    }

    equals(other: Version): boolean {
        return this.compare(other) === 0
    }
}

enum VersionBump {
    prlabel,
    norelease,
    major,
    minor,
    patch,
}

enum ReleaseMode {
    prerelease,
    release,
    promote,
}

enum VersionBumpAction {
    Major,
    Minor,
    Patch,
}

const inputs: Inputs = {
    githubToken: core.getInput('github_token', { required: true }),
    repoOwner: core.getInput('repo_owner',),
    repoName: core.getInput('repo_name'),
    versionBump: core.getInput('version_bump'),
    releaseMode: core.getInput('release_mode', { required: true }),
    promoteFrom: core.getInput('promote_from'),
}

const octokit = github.getOctokit(inputs.githubToken)
const owner = inputs.repoOwner === '' ? github.context.repo.owner : inputs.repoOwner
const repo = inputs.repoName === '' ? github.context.repo.repo : inputs.repoName
const versionBump: VersionBump | undefined = VersionBump[inputs.versionBump.toLowerCase() as keyof typeof VersionBump]
const releaseMode: ReleaseMode | undefined = ReleaseMode[inputs.releaseMode.toLowerCase() as keyof typeof ReleaseMode]

main().catch(err => {
    console.error(err)
    core.setFailed(err.message)
})

async function main() {
    if (!releaseMode) {
        core.setFailed(`release_mode must be one of ${Object.keys(ReleaseMode).join(', ')}.`)
        return
    }
    if (releaseMode in [ReleaseMode.release, ReleaseMode.prerelease] && versionBump === null) {
        core.setFailed(`version_bump must be one of ${Object.keys(VersionBump).join(', ')} when release_mode is ${releaseMode}.`)
        return
    }
    if (releaseMode !== ReleaseMode.promote && inputs.promoteFrom !== '') {
        core.setFailed('promote_from was specified but release_mode was not promote. Please specify release_mode as promote.')
        return
    }

    if (releaseMode === ReleaseMode.prerelease) {
        await prerelease()
    }
    else if (releaseMode === ReleaseMode.release) {
        await release()
    }
    else if (releaseMode === ReleaseMode.promote) {
        await promote()
    }
    else {
        core.setFailed(`Unhandled release mode: ${releaseMode}`)
    }
}

async function release() {
    const versionBumpAction = await getVersionBumpAction()
    if (versionBumpAction === null) {
        core.info('No release will be created.')
        return
    }

    const latestRelease: Release | undefined = await getLatestRelease()
    const latestPrerelease: Release | undefined = await getLatestPrerelease()

    const releaseVersion = tagToVersion(await getLatestReleaseTag(latestRelease))
    const prereleaseVersion = tagToVersion(await getLatestPrereleaseTag(latestPrerelease))

    core.info(`Latest release: ${JSON.stringify(releaseVersion)}`)
    core.info(`Latest prerelease: ${JSON.stringify(prereleaseVersion)}`)
}

async function prerelease() {
    const versionBumpAction = await getVersionBumpAction()
    if (versionBumpAction === null) {
        core.info('No release will be created.')
        return
    }
    
    const latestRelease: Release | undefined = await getLatestRelease()
    const latestPrerelease: Release | undefined = await getLatestPrerelease()

    const releaseVersion = tagToVersion(await getLatestReleaseTag(latestRelease))
    const prereleaseVersion = tagToVersion(await getLatestPrereleaseTag(latestPrerelease))

    core.info(`Latest release: ${JSON.stringify(releaseVersion)}`)
    core.info(`Latest prerelease: ${JSON.stringify(prereleaseVersion)}`)
}

async function promote() {
    core.info('promote')
}

async function getVersionBumpAction(): Promise<VersionBumpAction | null> {
    if (versionBump === VersionBump.norelease) {
        core.info('No release will be created.')
        return null
    }
    else if (versionBump === VersionBump.prlabel) {
        return getVersionBumpActionFromPRLabel()
    }
    else if (versionBump === VersionBump.major) {
        return VersionBumpAction.Major
    }
    else if (versionBump === VersionBump.minor) {
        return VersionBumpAction.Minor
    }
    else if (versionBump === VersionBump.patch) {
        return VersionBumpAction.Patch
    }
    core.error(`Unhandled version bump mode: ${versionBump}`)
    return null
}

async function getVersionBumpActionFromPRLabel(): Promise<VersionBumpAction | null> {
    const associatedPrs: ListAssociatedPullRequests["response"] = await octokit.request(listAssociatedPullRequests, {
        owner,
        repo,
        commit_sha: github.context.sha,
    })
    if (associatedPrs.data.length === 0) {
        core.error('No PRs associated with this commit.')
        return null
    }
    const targetPr = associatedPrs.data[0]
    const versionBumpActions: (VersionBumpAction | null)[] = targetPr.labels.map(label => label.name).map((label) => {
        if (label === 'release:major') {
            return VersionBumpAction.Major
        } else if (label === 'release:minor') {
            return VersionBumpAction.Minor
        } else if (label === 'release:patch') {
            return VersionBumpAction.Patch
        }
        return null
    }).filter((label) => label !== null)

    if (versionBumpActions.length === 0) {
        core.error('No release labels found on the PR.')
        return null
    }
    if (versionBumpActions.length > 1) {
        core.error('Multiple release labels found on the PR.')
        return null
    }

    return versionBumpActions[0]
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
    const [versionPart, prePart] = tag.split('-')
    const [major, minor, patch] = versionPart.split('.').map((v) => parseInt(v))
    if (prePart === undefined) {
        return new Version(major, minor, patch, Number.MAX_VALUE)
    }
    const [_, prereleaseNumber] = prePart.split('.')
    const prerelease = prereleaseNumber === undefined ? 0 : parseInt(prereleaseNumber)
    return new Version(major, minor, patch, prerelease)
}





// async function createRelease(versionBumpAction: VersionBumpAction) {
//     const latestRelease: Release | undefined = await getLatestRelease()
//     const latestPrerelease: Release | undefined = await getLatestPrerelease()

//     const releaseVersion = tagToVersion(await getLatestReleaseTag(latestRelease))
//     const prereleaseVersion = tagToVersion(await getLatestPrereleaseTag(latestPrerelease))

//     core.info(`Latest release: ${JSON.stringify(releaseVersion)}`)
//     core.info(`Latest prerelease: ${JSON.stringify(prereleaseVersion)}`)

//     const newReleaseVersion = new Version(0, 0, 0)

//     core.info(`New release version: ${JSON.stringify(newReleaseVersion)}`)
// }
