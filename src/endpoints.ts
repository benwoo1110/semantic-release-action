import { Endpoints } from '@octokit/types'

export const listAssociatedPullRequests = 'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls' as const
export const createRelease = 'POST /repos/{owner}/{repo}/releases' as const

export type ListAssociatedPullRequests = Endpoints[typeof listAssociatedPullRequests]
export type CreateRelease = Endpoints[typeof createRelease]
