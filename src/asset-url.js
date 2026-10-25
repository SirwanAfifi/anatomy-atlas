// Vite supplies the deployment prefix; direct Node imports retain the local root.
export const basePath = import.meta.env?.BASE_URL || '/';

export function assetUrl(path) {
  return `${basePath}${path.replace(/^\/+/, '')}`;
}
