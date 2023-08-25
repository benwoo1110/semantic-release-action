"use strict";
import core from "@actions/core";
import github from "@actions/github";
import { createRelease, getReleaseByTag, listAssociatedPullRequests, listRepositoryTags } from "./endpoints.js";
var ReleaseMode = /* @__PURE__ */ ((ReleaseMode2) => {
  ReleaseMode2[ReleaseMode2["prerelease"] = 0] = "prerelease";
  ReleaseMode2[ReleaseMode2["release"] = 1] = "release";
  ReleaseMode2[ReleaseMode2["promote"] = 2] = "promote";
  return ReleaseMode2;
})(ReleaseMode || {});
var VersionBump = /* @__PURE__ */ ((VersionBump2) => {
  VersionBump2[VersionBump2["prlabel"] = 0] = "prlabel";
  VersionBump2[VersionBump2["norelease"] = 1] = "norelease";
  VersionBump2[VersionBump2["major"] = 2] = "major";
  VersionBump2[VersionBump2["minor"] = 3] = "minor";
  VersionBump2[VersionBump2["patch"] = 4] = "patch";
  return VersionBump2;
})(VersionBump || {});
var VersionBumpAction = /* @__PURE__ */ ((VersionBumpAction2) => {
  VersionBumpAction2[VersionBumpAction2["Major"] = 0] = "Major";
  VersionBumpAction2[VersionBumpAction2["Minor"] = 1] = "Minor";
  VersionBumpAction2[VersionBumpAction2["Patch"] = 2] = "Patch";
  return VersionBumpAction2;
})(VersionBumpAction || {});
class Version {
  constructor(major, minor, patch, prerelease = Number.MAX_VALUE) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
    this.prerelease = prerelease;
  }
  isMajorRelease() {
    return this.minor === 0 && this.patch === 0;
  }
  isMinorRelease() {
    return this.patch === 0;
  }
  isPatchRelease() {
    return this.patch > 0;
  }
  isPreRelease() {
    return this.prerelease < Number.MAX_VALUE;
  }
  isAtLeastMajorRelease() {
    return this.isMajorRelease();
  }
  isAtLeastMinorRelease() {
    return this.isMajorRelease() || this.isMinorRelease();
  }
  isAtLeastPatchRelease() {
    return this.isMajorRelease() || this.isMinorRelease() || this.isPatchRelease();
  }
  compare(other) {
    if (this.major > other.major) {
      return 1;
    } else if (this.major < other.major) {
      return -1;
    }
    if (this.minor > other.minor) {
      return 1;
    } else if (this.minor < other.minor) {
      return -1;
    }
    if (this.patch > other.patch) {
      return 1;
    } else if (this.patch < other.patch) {
      return -1;
    }
    if (this.prerelease > other.prerelease) {
      return 1;
    } else if (this.prerelease < other.prerelease) {
      return -1;
    }
    return 0;
  }
  greaterThan(other) {
    return this.compare(other) > 0;
  }
  lessThan(other) {
    return this.compare(other) < 0;
  }
  equals(other) {
    return this.compare(other) === 0;
  }
  toTag() {
    if (this.isPreRelease()) {
      if (this.prerelease === 0) {
        return `${this.major}.${this.minor}.${this.patch}-pre`;
      }
      return `${this.major}.${this.minor}.${this.patch}-pre.${this.prerelease}`;
    }
    return `${this.major}.${this.minor}.${this.patch}`;
  }
  toPublishVersion() {
    if (this.isPreRelease()) {
      return `${this.major}.${this.minor}.${this.patch}-SNAPSHOT`;
    }
    return `${this.major}.${this.minor}.${this.patch}`;
  }
}
const inputs = {
  githubToken: core.getInput("github_token", { required: true }),
  repoOwner: core.getInput("repo_owner"),
  repoName: core.getInput("repo_name"),
  versionBump: core.getInput("version_bump"),
  releaseMode: core.getInput("release_mode", { required: true }),
  promoteFrom: core.getInput("promote_from")
};
const octokit = github.getOctokit(inputs.githubToken);
const owner = inputs.repoOwner === "" ? github.context.repo.owner : inputs.repoOwner;
const repo = inputs.repoName === "" ? github.context.repo.repo : inputs.repoName;
const versionBump = VersionBump[inputs.versionBump];
const releaseMode = ReleaseMode[inputs.releaseMode];
core.info(`owner: ${owner}`);
core.info(`repo: ${repo}`);
core.info(`version_bump: ${versionBump}`);
core.info(`release_mode: ${releaseMode}`);
main().catch((err) => {
  console.error(err);
  core.setFailed(err.message);
});
async function main() {
  if (releaseMode === void 0) {
    core.setFailed(`Invalid release_mode: ${inputs.releaseMode}. release_mode must be one of ${Object.keys(ReleaseMode).join(", ")}.`);
    return;
  }
  if (releaseMode in [1 /* release */, 0 /* prerelease */] && versionBump === null) {
    core.setFailed(`version_bump must be one of ${Object.keys(VersionBump).join(", ")} when release_mode is ${releaseMode}.`);
    return;
  }
  if (releaseMode !== 2 /* promote */ && inputs.promoteFrom !== "") {
    core.setFailed("promote_from was specified but release_mode was not promote. Please specify release_mode as promote.");
    return;
  }
  if (releaseMode === 0 /* prerelease */) {
    await release(true);
  } else if (releaseMode === 1 /* release */) {
    await release(false);
  } else if (releaseMode === 2 /* promote */) {
    await promote();
  } else {
    core.setFailed(`Unhandled release mode: ${releaseMode}`);
  }
}
async function release(prerelease) {
  const versionBumpAction = await getVersionBumpAction();
  if (versionBumpAction === null) {
    core.info("No release will be created.");
    core.setOutput("release_created", false);
    return;
  }
  const versions = await getRepoTags();
  const latestReleaseVersion = findLatestVersion(versions);
  if (latestReleaseVersion === void 0) {
    core.setFailed("No releases found.");
    return;
  }
  core.info(`Latest release: ${JSON.stringify(latestReleaseVersion)}`);
  const nextVersion = getNextVersion(latestReleaseVersion, versionBumpAction, prerelease);
  core.info(`Next version: ${nextVersion.toTag()}`);
  const newReleaseData = await doRelease(nextVersion);
  core.info(`New release: ${JSON.stringify(newReleaseData)}`);
  setReleaseOutputs(nextVersion, newReleaseData);
}
async function promote() {
  const targetVersion = inputs.promoteFrom === "" ? findLatestVersion(await getRepoTags(), true) : tagToVersion(inputs.promoteFrom);
  if (targetVersion === void 0) {
    core.setFailed("No version found.");
    return;
  }
  core.info(`Target version: ${targetVersion.toTag()}`);
  const targetPrerelease = await getReleaseFromTag(targetVersion.toTag());
  if (targetPrerelease === void 0) {
    core.setFailed("No prerelease found.");
    return;
  } else if (!targetPrerelease.prerelease) {
    core.setFailed("The specified release is not a prerelease.");
    return;
  }
  const latestPrereleaseVersion = tagToVersion(targetPrerelease.tag_name);
  const nextVersion = getNextVersion(latestPrereleaseVersion, 2 /* Patch */, false);
  core.info(`Next version: ${nextVersion.toTag()}`);
  const newReleaseData = await doRelease(nextVersion);
  core.info(`New release: ${JSON.stringify(newReleaseData)}`);
  setReleaseOutputs(nextVersion, newReleaseData);
}
async function getVersionBumpAction() {
  if (versionBump === 1 /* norelease */) {
    core.info("No release will be created.");
    return null;
  } else if (versionBump === 0 /* prlabel */) {
    return getVersionBumpActionFromPRLabel();
  } else if (versionBump === 2 /* major */) {
    return 0 /* Major */;
  } else if (versionBump === 3 /* minor */) {
    return 1 /* Minor */;
  } else if (versionBump === 4 /* patch */) {
    return 2 /* Patch */;
  }
  core.setFailed(`Unhandled version bump mode: ${versionBump}`);
  process.exit(1);
}
async function getVersionBumpActionFromPRLabel() {
  const associatedPrs = await octokit.request(listAssociatedPullRequests, {
    owner,
    repo,
    commit_sha: github.context.sha
  });
  if (associatedPrs.data.length === 0) {
    core.error("No PRs associated with this commit.");
    return null;
  }
  const targetPr = associatedPrs.data[0];
  const versionBumpActions = targetPr.labels.map((label) => label.name).map((label) => {
    if (label === "release:major") {
      return 0 /* Major */;
    } else if (label === "release:minor") {
      return 1 /* Minor */;
    } else if (label === "release:patch") {
      return 2 /* Patch */;
    }
    return null;
  }).filter((label) => label !== null);
  if (versionBumpActions.length === 0) {
    core.error("No release labels found on the PR.");
    return null;
  }
  if (versionBumpActions.length > 1) {
    core.error("Multiple release labels found on the PR.");
    return null;
  }
  return versionBumpActions[0];
}
async function getRepoTags() {
  const tags = await octokit.request(listRepositoryTags, {
    owner,
    repo,
    per_page: 100
  });
  return tags.data.map((tag) => tagToVersion(tag.name));
}
async function getReleaseFromTag(tag) {
  const release2 = await octokit.request(getReleaseByTag, {
    owner,
    repo,
    tag
  });
  return release2.data;
}
function findLatestVersion(versions, prereleaseOnly = false) {
  const filteredVersions = prereleaseOnly ? versions.filter((version) => version.isPreRelease()) : versions;
  if (filteredVersions.length === 0) {
    return void 0;
  }
  return filteredVersions.reduce((prev, current) => prev.greaterThan(current) ? prev : current);
}
function tagToVersion(tag) {
  const [versionPart, prePart] = tag.split("-");
  const [major, minor, patch] = versionPart.split(".").map((v) => parseInt(v));
  if (prePart === void 0) {
    return new Version(major, minor, patch, Number.MAX_VALUE);
  }
  const [pre, prereleaseNumber] = prePart.split(".");
  if (pre !== "pre") {
    core.setFailed(`Invalid prerelease tag: ${tag}`);
    process.exit(1);
  }
  const prerelease = prereleaseNumber === void 0 ? 0 : parseInt(prereleaseNumber);
  return new Version(major, minor, patch, prerelease);
}
function getNextVersion(version, versionBumpAction, prerelease) {
  if (version.isPreRelease()) {
    if (prerelease) {
      return bumpFromPrereleaseToPrerelease(version, versionBumpAction);
    }
    return bumpFromPrereleaseToRelease(version, versionBumpAction);
  }
  if (prerelease) {
    return bumpFromReleaseToPrerelease(version, versionBumpAction);
  }
  return bumpFromReleaseToRelease(version, versionBumpAction);
}
function bumpFromPrereleaseToPrerelease(version, versionBumpAction) {
  switch (versionBumpAction) {
    case 0 /* Major */:
      if (version.isAtLeastMajorRelease()) {
        return new Version(version.major, 0, 0, version.prerelease + 1);
      }
      return new Version(version.major + 1, 0, 0, 0);
    case 1 /* Minor */:
      if (version.isAtLeastMinorRelease()) {
        return new Version(version.major, version.minor, 0, version.prerelease + 1);
      }
      return new Version(version.major, version.minor + 1, 0, 0);
    case 2 /* Patch */:
      if (version.isAtLeastPatchRelease()) {
        return new Version(version.major, version.minor, version.patch, version.prerelease + 1);
      }
      return new Version(version.major, version.minor, version.patch + 1, 0);
    default:
      core.setFailed(`Unhandled version bump action: ${versionBumpAction}`);
      process.exit(1);
  }
}
function bumpFromPrereleaseToRelease(version, versionBumpAction) {
  switch (versionBumpAction) {
    case 0 /* Major */:
      if (version.isAtLeastMajorRelease()) {
        return new Version(version.major, 0, 0);
      }
      return new Version(version.major + 1, 0, 0);
    case 1 /* Minor */:
      if (version.isAtLeastMinorRelease()) {
        return new Version(version.major, version.minor, 0);
      }
      return new Version(version.major, version.minor + 1, 0);
    case 2 /* Patch */:
      if (version.isAtLeastPatchRelease()) {
        return new Version(version.major, version.minor, version.patch);
      }
      return new Version(version.major, version.minor, version.patch + 1);
    default:
      core.setFailed(`Unhandled version bump action: ${versionBumpAction}`);
      process.exit(1);
  }
}
function bumpFromReleaseToPrerelease(version, versionBumpAction) {
  switch (versionBumpAction) {
    case 0 /* Major */:
      return new Version(version.major + 1, 0, 0, 0);
    case 1 /* Minor */:
      return new Version(version.major, version.minor + 1, 0, 0);
    case 2 /* Patch */:
      return new Version(version.major, version.minor, version.patch + 1, 0);
    default:
      core.setFailed(`Unhandled version bump action: ${versionBumpAction}`);
      process.exit(1);
  }
}
function bumpFromReleaseToRelease(version, versionBumpAction) {
  switch (versionBumpAction) {
    case 0 /* Major */:
      return new Version(version.major + 1, 0, 0);
    case 1 /* Minor */:
      return new Version(version.major, version.minor + 1, 0);
    case 2 /* Patch */:
      return new Version(version.major, version.minor, version.patch + 1);
    default:
      core.setFailed(`Unhandled version bump action: ${versionBumpAction}`);
      process.exit(1);
  }
}
async function doRelease(version) {
  const release2 = await octokit.request(createRelease, {
    owner,
    repo,
    tag_name: version.toTag(),
    prerelease: version.isPreRelease(),
    generate_release_notes: true
  });
  return release2.data;
}
async function setReleaseOutputs(version, releaseData) {
  core.setOutput("release_created", true);
  core.setOutput("tag_name", releaseData.tag_name);
  core.setOutput("prerelease", releaseData.prerelease);
  core.setOutput("body", releaseData.body);
  core.setOutput("publish_version", version.toPublishVersion());
  core.setOutput("release_type", releaseData.prerelease ? "beta" : "release");
}
