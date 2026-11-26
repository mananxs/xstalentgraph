/**
 * GraphQL document for searching users and reading ONLY public profile metadata.
 *
 * Deliberately NOT requested:
 *  - `email`: it needs the read:user scope and made the whole query fail earlier. Our tokens have no scopes.
 *  - code, commits, file contents, issues or pull requests: never read.
 *
 * Per user we read their own (non-fork) public repositories (first 30), with the top 5 languages
 * by size and up to 10 topics each.
 */
export const SEARCH_USERS_QUERY = /* GraphQL */ `
  query SearchUsers($searchQuery: String!, $first: Int!, $after: String) {
    rateLimit {
      cost
      remaining
      resetAt
    }
    search(query: $searchQuery, type: USER, first: $first, after: $after) {
      userCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ... on User {
          databaseId
          login
          name
          bio
          location
          createdAt
          avatarUrl
          url
          repositories(
            first: 30
            isFork: false
            privacy: PUBLIC
            ownerAffiliations: OWNER
            orderBy: { field: PUSHED_AT, direction: DESC }
          ) {
            nodes {
              languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
                edges {
                  size
                  node {
                    name
                  }
                }
              }
              repositoryTopics(first: 10) {
                nodes {
                  topic {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;
