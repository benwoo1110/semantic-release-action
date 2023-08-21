"use strict";
import core from "@actions/core";
import github from "@actions/github";
import { listAssociatedPullRequests } from "./endpoints";
var VersionBumpMode = /* @__PURE__ */ ((VersionBumpMode2) => {
  VersionBumpMode2["Major"] = "major";
  VersionBumpMode2["Minor"] = "minor";
  VersionBumpMode2["Patch"] = "patch";
  VersionBumpMode2["PRLabel"] = "prlabel";
  VersionBumpMode2["NoRelease"] = "norelease";
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
  prerelease: core.getBooleanInput("prerelease"),
  tagPrefix: core.getInput("tag_prefix")
};
const octokit = github.getOctokit(inputs.githubToken);
const owner = inputs.repoOwner === "" ? github.context.repo.owner : inputs.repoOwner;
const repo = inputs.repoName === "" ? github.context.repo.repo : inputs.repoName;
const versionBumpMode = VersionBumpMode[inputs.versionBumpMode];
main().catch((err) => {
  console.error(err);
  core.setFailed(err.message);
});
async function main() {
  const versionBumpAction = await getVersionBumpAction();
  if (versionBumpAction === 3 /* None */) {
    core.info("No release will be created.");
    return;
  }
  core.info(`Version bump action: ${versionBumpAction}`);
}
async function getVersionBumpAction() {
  if (versionBumpMode === "norelease" /* NoRelease */) {
    core.info("No release will be created.");
    return 3 /* None */;
  } else if (versionBumpMode === "prlabel" /* PRLabel */) {
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
  } else if (versionBumpMode === "major" /* Major */) {
    return 0 /* Major */;
  } else if (versionBumpMode === "minor" /* Minor */) {
    return 1 /* Minor */;
  } else if (versionBumpMode === "patch" /* Patch */) {
    return 2 /* Patch */;
  } else {
    core.error(`Unknown version bump mode: ${versionBumpMode}`);
    return 3 /* None */;
  }
}
