import { Endpoints } from '@octokit/types'

export const listAssociatedPullRequests = 'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls' as const
export const latestRelease = 'GET /repos/{owner}/{repo}/releases/latest' as const
export const listReleases = 'GET /repos/{owner}/{repo}/releases' as const
export const getReleaseByTag = 'GET /repos/{owner}/{repo}/releases/tags/{tag}' as const
export const createRelease = 'POST /repos/{owner}/{repo}/releases' as const

export type ListAssociatedPullRequests = Endpoints[typeof listAssociatedPullRequests]
export type LatestRelease = Endpoints[typeof latestRelease]
export type ListReleases = Endpoints[typeof listReleases]
export type GetReleaseByTag = Endpoints[typeof getReleaseByTag]
export type CreateRelease = Endpoints[typeof createRelease]
