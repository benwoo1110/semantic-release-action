"use strict";
export const listAssociatedPullRequests = "GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls";
export const latestRelease = "GET /repos/{owner}/{repo}/releases/latest";
export const listReleases = "GET /repos/{owner}/{repo}/releases";
export const getReleaseByTag = "GET /repos/{owner}/{repo}/releases/tags/{tag}";
export const createRelease = "POST /repos/{owner}/{repo}/releases";
