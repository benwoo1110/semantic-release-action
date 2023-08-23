import core from '@actions/core'
import github from '@actions/github'
import { CreateRelease, LatestRelease, ListAssociatedPullRequests, ListRepositoryTags, createRelease, getReleaseByTag, listAssociatedPullRequests, listRepositoryTags } from './endpoints.js'

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
    target_commitish: string
    body?: string | null | undefined
}

enum ReleaseMode {
    prerelease,
    release,
    promote,
}

enum VersionBump {
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

    isAtLeastMajorRelease(): boolean {
        return this.isMajorRelease()
    }

    isAtLeastMinorRelease(): boolean {
        return this.isMajorRelease() || this.isMinorRelease()
    }

    isAtLeastPatchRelease(): boolean {
        return this.isMajorRelease() || this.isMinorRelease() || this.isPatchRelease()
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

    toTag(): string {
        if (this.isPreRelease()) {
            if (this.prerelease === 0) {
                return `${this.major}.${this.minor}.${this.patch}-pre`
            }
            return `${this.major}.${this.minor}.${this.patch}-pre.${this.prerelease}`
        }
        return `${this.major}.${this.minor}.${this.patch}`
    }

    toPublishVersion(): string {
        if (this.isPreRelease()) {
            return `${this.major}.${this.minor}.${this.patch}-SNAPSHOT`
        }
        return `${this.major}.${this.minor}.${this.patch}`
    }
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
const versionBump: VersionBump | undefined = VersionBump[inputs.versionBump as keyof typeof VersionBump]
const releaseMode: ReleaseMode | undefined = ReleaseMode[inputs.releaseMode as keyof typeof ReleaseMode]

core.info(`owner: ${owner}`)
core.info(`repo: ${repo}`)
core.info(`version_bump: ${versionBump}`)
core.info(`release_mode: ${releaseMode}`)

main().catch(err => {
    console.error(err)
    core.setFailed(err.message)
})

async function main() {
    if (releaseMode === undefined) {
        core.setFailed(`Invalid release_mode: ${inputs.releaseMode}. release_mode must be one of ${Object.keys(ReleaseMode).join(', ')}.`)
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
        await release(true)
    }
    else if (releaseMode === ReleaseMode.release) {
        await release(false)
    }
    else if (releaseMode === ReleaseMode.promote) {
        await promote()
    }
    else {
        core.setFailed(`Unhandled release mode: ${releaseMode}`)
    }
}

async function release(prerelease: boolean) {
    const versionBumpAction = await getVersionBumpAction()
    if (versionBumpAction === null) {
        core.info('No release will be created.')
        core.setOutput('release_created', false)
        return
    }

    const versions = await getRepoTags()
    const latestReleaseVersion = findLatestVersion(versions, prerelease)
    if (latestReleaseVersion === undefined) {
        core.setFailed('No releases found.')
        return
    }
    core.info(`Latest release: ${JSON.stringify(latestReleaseVersion)}`)

    const nextVersion = getNextVersion(latestReleaseVersion, versionBumpAction, prerelease)
    core.info(`Next version: ${nextVersion.toTag()}`)

    const newReleaseData: Release = await doRelease(nextVersion)
    core.info(`New release: ${JSON.stringify(newReleaseData)}`)
    setReleaseOutputs(nextVersion, newReleaseData)
}

async function promote() {
    const targetVersion: Version | undefined = inputs.promoteFrom === '' ? findLatestVersion(await getRepoTags(), false) : tagToVersion(inputs.promoteFrom)
    if (targetVersion === undefined) {
        core.setFailed('No version found.')
        return
    }

    core.info(`Target version: ${targetVersion.toTag()}`)

    const targetPrerelease = await getReleaseFromTag(targetVersion.toTag())
    if (targetPrerelease === undefined) {
        core.setFailed('No prerelease found.')
        return
    }
    else if (!targetPrerelease.prerelease) {
        core.setFailed('The specified release is not a prerelease.')
        return
    }

    const latestPrereleaseVersion = tagToVersion(targetPrerelease.tag_name)
    const nextVersion = getNextVersion(latestPrereleaseVersion, VersionBumpAction.Patch, false)
    core.info(`Next version: ${nextVersion.toTag()}`)

    const newReleaseData: Release = await doRelease(nextVersion)
    core.info(`New release: ${JSON.stringify(newReleaseData)}`)
    setReleaseOutputs(nextVersion, newReleaseData)
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
    core.setFailed(`Unhandled version bump mode: ${versionBump}`)
    process.exit(1)
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

async function getRepoTags(): Promise<Version[]> {
    const tags: ListRepositoryTags["response"] = await octokit.request(listRepositoryTags, {
        owner,
        repo,
        per_page: 100,
    })
    return tags.data.map((tag) => tagToVersion(tag.name))
}

async function getReleaseFromTag(tag: string) {
    const release: LatestRelease["response"] = await octokit.request(getReleaseByTag, {
        owner,
        repo,
        tag,
    })
    return release.data
}

function findLatestVersion(versions: Version[], prerelease: boolean): Version | undefined {
    const filteredVersions = versions.filter((version) => version.isPreRelease() === prerelease)
    if (filteredVersions.length === 0) {
        return undefined
    }
    return filteredVersions.reduce((prev, current) => prev.greaterThan(current) ? prev : current)
}

function tagToVersion(tag: string): Version {
    // release format: <major>.<minor>.<patch>
    // prerelease format: <major>.<minor>.<patch>-pre.<prerelease>
    const [versionPart, prePart] = tag.split('-')
    const [major, minor, patch] = versionPart.split('.').map((v) => parseInt(v))
    if (prePart === undefined) {
        return new Version(major, minor, patch, Number.MAX_VALUE)
    }
    const [pre, prereleaseNumber] = prePart.split('.')
    if (pre !== 'pre') {
        core.setFailed(`Invalid prerelease tag: ${tag}`)
        process.exit(1)
    }
    const prerelease = prereleaseNumber === undefined ? 0 : parseInt(prereleaseNumber)
    return new Version(major, minor, patch, prerelease)
}

function getNextVersion(version: Version, versionBumpAction: VersionBumpAction, prerelease: boolean): Version {
    if (version.isPreRelease()) {
        if (prerelease) {
            return bumpFromPrereleaseToPrerelease(version, versionBumpAction)
        }
        return bumpFromPrereleaseToRelease(version, versionBumpAction)
    }
    if (prerelease) {
        return bumpFromReleaseToPrerelease(version, versionBumpAction)
    }
    return bumpFromReleaseToRelease(version, versionBumpAction)
}

function bumpFromPrereleaseToPrerelease(version: Version, versionBumpAction: VersionBumpAction): Version {
    switch (versionBumpAction) {
        case VersionBumpAction.Major:
            if (version.isAtLeastMajorRelease()) {
                return new Version(version.major, 0, 0, version.prerelease + 1)
            }
            return new Version(version.major + 1, 0, 0, 0)
        case VersionBumpAction.Minor:
            if (version.isAtLeastMinorRelease()) {
                return new Version(version.major, version.minor, 0, version.prerelease + 1)
            }
            return new Version(version.major, version.minor + 1, 0, 0)
        case VersionBumpAction.Patch:
            if (version.isAtLeastPatchRelease()) {
                return new Version(version.major, version.minor, version.patch, version.prerelease + 1)
            }
            return new Version(version.major, version.minor, version.patch + 1, 0)
        default:
            core.setFailed(`Unhandled version bump action: ${versionBumpAction}`)
            process.exit(1)
    }
}

function bumpFromPrereleaseToRelease(version: Version, versionBumpAction: VersionBumpAction): Version {
    switch (versionBumpAction) {
        case VersionBumpAction.Major:
            if (version.isAtLeastMajorRelease()) {
                return new Version(version.major, 0, 0)
            }
            return new Version(version.major + 1, 0, 0)
        case VersionBumpAction.Minor:
            if (version.isAtLeastMinorRelease()) {
                return new Version(version.major, version.minor, 0)
            }
            return new Version(version.major, version.minor + 1, 0)
        case VersionBumpAction.Patch:
            if (version.isAtLeastPatchRelease()) {
                return new Version(version.major, version.minor, version.patch)
            }
            return new Version(version.major, version.minor, version.patch + 1)
        default:
            core.setFailed(`Unhandled version bump action: ${versionBumpAction}`)
            process.exit(1)
    }
}

function bumpFromReleaseToPrerelease(version: Version, versionBumpAction: VersionBumpAction): Version {
    switch (versionBumpAction) {
        case VersionBumpAction.Major:
            return new Version(version.major + 1, 0, 0, 0)
        case VersionBumpAction.Minor:
            return new Version(version.major, version.minor + 1, 0, 0)
        case VersionBumpAction.Patch:
            return new Version(version.major, version.minor, version.patch + 1, 0)
        default:
            core.setFailed(`Unhandled version bump action: ${versionBumpAction}`)
            process.exit(1)
    }
}

function bumpFromReleaseToRelease(version: Version, versionBumpAction: VersionBumpAction): Version {
    switch (versionBumpAction) {
        case VersionBumpAction.Major:
            return new Version(version.major + 1, 0, 0)
        case VersionBumpAction.Minor:
            return new Version(version.major, version.minor + 1, 0)
        case VersionBumpAction.Patch:
            return new Version(version.major, version.minor, version.patch + 1)
        default:
            core.setFailed(`Unhandled version bump action: ${versionBumpAction}`)
            process.exit(1)
    }
}

async function doRelease(version: Version) {
    const release: CreateRelease["response"] = await octokit.request(createRelease, {
        owner,
        repo,
        tag_name: version.toTag(),
        prerelease: version.isPreRelease(),
        generate_release_notes: true,
    })
    return release.data
}

async function setReleaseOutputs(version: Version, releaseData: Release) {
    core.setOutput('release_created', true)
    core.setOutput('tag_name', releaseData.tag_name)
    core.setOutput('prerelease', releaseData.prerelease)
    core.setOutput('body', releaseData.body)
    core.setOutput('publish_version', version.toPublishVersion())
    core.setOutput('release_type', releaseData.prerelease ? 'beta' : 'release')
}
