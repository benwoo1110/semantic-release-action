"use strict";
import core from "@actions/core";
import github from "@actions/github";
import { latestRelease, listAssociatedPullRequests, listReleases } from "./endpoints.js";
var VersionBumpMode = /* @__PURE__ */ ((VersionBumpMode2) => {
  VersionBumpMode2[VersionBumpMode2["prlabel"] = 0] = "prlabel";
  VersionBumpMode2[VersionBumpMode2["norelease"] = 1] = "norelease";
  VersionBumpMode2[VersionBumpMode2["major"] = 2] = "major";
  VersionBumpMode2[VersionBumpMode2["minor"] = 3] = "minor";
  VersionBumpMode2[VersionBumpMode2["patch"] = 4] = "patch";
  return VersionBumpMode2;
})(VersionBumpMode || {});
var VersionBumpAction = /* @__PURE__ */ ((VersionBumpAction2) => {
  VersionBumpAction2[VersionBumpAction2["Major"] = 0] = "Major";
  VersionBumpAction2[VersionBumpAction2["Minor"] = 1] = "Minor";
  VersionBumpAction2[VersionBumpAction2["Patch"] = 2] = "Patch";
  VersionBumpAction2[VersionBumpAction2["None"] = 3] = "None";
  return VersionBumpAction2;
})(VersionBumpAction || {});
const inputs = {
  githubToken: core.getInput("github_token", { required: true }),
  repoOwner: core.getInput("repo_owner"),
  repoName: core.getInput("repo_name"),
  versionBumpMode: core.getInput("version_bump_mode"),
  prerelease: core.getBooleanInput("prerelease")
};
const octokit = github.getOctokit(inputs.githubToken);
const owner = inputs.repoOwner === "" ? github.context.repo.owner : inputs.repoOwner;
const repo = inputs.repoName === "" ? github.context.repo.repo : inputs.repoName;
const versionBumpMode = VersionBumpMode[inputs.versionBumpMode.toLowerCase()];
main().catch((err) => {
  console.error(err);
  core.setFailed(err.message);
});
async function main() {
  if (versionBumpMode === void 0) {
    core.error(`Unknown version bump mode: ${inputs.versionBumpMode}`);
    core.error("Version bump mode must be one of: prlabel, norelease, major, minor, patch");
    core.setFailed("Invalid version bump mode");
    return;
  }
  const versionBumpAction = await getVersionBumpAction();
  core.info(`Version bump action: ${versionBumpAction}`);
  createRelease(versionBumpAction);
}
async function getVersionBumpAction() {
  if (versionBumpMode === 1 /* norelease */) {
    core.info("No release will be created.");
    return 3 /* None */;
  } else if (versionBumpMode === 0 /* prlabel */) {
    const associatedPrs = await octokit.request(listAssociatedPullRequests, {
      owner,
      repo,
      commit_sha: github.context.sha
    });
    if (associatedPrs.data.length === 0) {
      core.error("No PRs associated with this commit.");
      return 3 /* None */;
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
      return 3 /* None */;
    }).filter((label) => label !== 3 /* None */);
    if (versionBumpActions.length === 0) {
      core.error("No release labels found on the PR.");
      return 3 /* None */;
    }
    if (versionBumpActions.length > 1) {
      core.error("Multiple release labels found on the PR.");
      return 3 /* None */;
    }
    return versionBumpActions[0];
  } else if (versionBumpMode === 2 /* major */) {
    return 0 /* Major */;
  } else if (versionBumpMode === 3 /* minor */) {
    return 1 /* Minor */;
  } else if (versionBumpMode === 4 /* patch */) {
    return 2 /* Patch */;
  } else {
    core.error(`Unhandled version bump mode: ${versionBumpMode}`);
    return 3 /* None */;
  }
}
async function createRelease(versionBumpAction) {
  if (versionBumpAction === 3 /* None */) {
    core.info("No release will be created.");
    return;
  }
  const latestRelease2 = await getLatestRelease();
  const latestPrerelease = await getLatestPrerelease();
  const latestReleaseTag = tagToVersion(await getLatestReleaseTag(latestRelease2));
  const latestPrereleaseTag = tagToVersion(await getLatestPrereleaseTag(latestPrerelease));
  core.info(`Latest release: ${JSON.stringify(latestReleaseTag)}`);
  core.info(`Latest prerelease: ${JSON.stringify(latestPrereleaseTag)}`);
}
async function getLatestRelease() {
  const release = await octokit.request(latestRelease, {
    owner,
    repo
  });
  return release.data;
}
async function getLatestPrerelease() {
  const releases = await octokit.request(listReleases, {
    owner,
    repo
  });
  return releases.data.find((release) => release.prerelease && !release.draft);
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
  const [versionpart, prepart] = tag.split("-");
  const [major, minor, patch] = versionpart.split(".").map((v) => parseInt(v));
  if (prepart === void 0) {
    return {
      major,
      minor,
      patch,
      prerelease: -1
    };
  }
  const [_, prerelease] = prepart.split(".");
  return {
    major,
    minor,
    patch,
    prerelease: parseInt(prerelease)
  };
}
