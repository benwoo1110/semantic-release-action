"use strict";
import core from "@actions/core";
import github from "@actions/github";
import { latestRelease, listAssociatedPullRequests, listReleases } from "./endpoints.js";
class Version {
  constructor(major, minor, patch, prerelease2 = Number.MAX_VALUE) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
    this.prerelease = prerelease2;
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
}
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
  if (!releaseMode) {
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
    await prerelease();
  } else if (releaseMode === 1 /* release */) {
    await release();
  } else if (releaseMode === 2 /* promote */) {
    await promote();
  } else {
    core.setFailed(`Unhandled release mode: ${releaseMode}`);
  }
}
async function prerelease() {
  core.info("prerelease");
  const versionBumpAction = await getVersionBumpAction();
  if (versionBumpAction === null) {
    core.info("No release will be created.");
    return;
  }
  const latestRelease2 = await getLatestRelease();
  const latestPrerelease = await getLatestPrerelease();
  const releaseVersion = tagToVersion(await getLatestReleaseTag(latestRelease2));
  const prereleaseVersion = tagToVersion(await getLatestPrereleaseTag(latestPrerelease));
  core.info(`Latest release: ${JSON.stringify(releaseVersion)}`);
  core.info(`Latest prerelease: ${JSON.stringify(prereleaseVersion)}`);
}
async function release() {
  core.info("release");
  const versionBumpAction = await getVersionBumpAction();
  if (versionBumpAction === null) {
    core.info("No release will be created.");
    return;
  }
  const latestRelease2 = await getLatestRelease();
  const latestPrerelease = await getLatestPrerelease();
  const releaseVersion = tagToVersion(await getLatestReleaseTag(latestRelease2));
  const prereleaseVersion = tagToVersion(await getLatestPrereleaseTag(latestPrerelease));
  core.info(`Latest release: ${JSON.stringify(releaseVersion)}`);
  core.info(`Latest prerelease: ${JSON.stringify(prereleaseVersion)}`);
}
async function promote() {
  core.info("promote");
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
  core.error(`Unhandled version bump mode: ${versionBump}`);
  return null;
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
async function getLatestRelease() {
  const release2 = await octokit.request(latestRelease, {
    owner,
    repo
  });
  return release2.data;
}
async function getLatestPrerelease() {
  const releases = await octokit.request(listReleases, {
    owner,
    repo
  });
  return releases.data.find((release2) => release2.prerelease && !release2.draft);
}
function getLatestReleaseTag(latestRelease2) {
  if (latestRelease2 === void 0) {
    return "0.0.0";
  }
  return latestRelease2.tag_name;
}
function getLatestPrereleaseTag(latestPrerelease) {
  if (latestPrerelease === void 0) {
    return "0.0.0-pre";
  }
  return latestPrerelease.tag_name;
}
function tagToVersion(tag) {
  const [versionPart, prePart] = tag.split("-");
  const [major, minor, patch] = versionPart.split(".").map((v) => parseInt(v));
  if (prePart === void 0) {
    return new Version(major, minor, patch, Number.MAX_VALUE);
  }
  const [_, prereleaseNumber] = prePart.split(".");
  const prerelease2 = prereleaseNumber === void 0 ? 0 : parseInt(prereleaseNumber);
  return new Version(major, minor, patch, prerelease2);
}
