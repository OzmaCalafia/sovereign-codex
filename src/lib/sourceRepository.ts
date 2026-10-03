// Optional "Review source code" footer link; only an https github.com/owner/repo URL is accepted.
const configuredRepositoryUrl = import.meta.env.VITE_GITHUB_REPOSITORY_URL?.trim();

function isGitHubRepositoryUrl(value: string | undefined): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    const pathParts = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:' && url.hostname === 'github.com' && pathParts.length === 2;
  } catch {
    return false;
  }
}

export const sourceRepositoryUrl = isGitHubRepositoryUrl(configuredRepositoryUrl)
  ? configuredRepositoryUrl
  : undefined;