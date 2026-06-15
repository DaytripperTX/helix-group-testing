import path from 'node:path';

export async function resolveStaticFilePath({ distDir, pathname, isExistingFile }) {
  const resolvedRequest = resolveStaticRequestPath(distDir, pathname);

  if (resolvedRequest.statusCode !== 200) {
    return resolvedRequest;
  }

  return {
    statusCode: 200,
    filePath: (await isExistingFile(resolvedRequest.filePath))
      ? resolvedRequest.filePath
      : path.join(distDir, 'index.html'),
  };
}

export function resolveStaticRequestPath(distDir, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    return { statusCode: 400 };
  }

  const resolvedPath = path.resolve(distDir, `.${decodedPath}`);

  if (!isPathInsideDirectory(distDir, resolvedPath)) {
    return { statusCode: 403 };
  }

  return {
    statusCode: 200,
    filePath: resolvedPath,
  };
}

export function isPathInsideDirectory(baseDir, candidatePath) {
  const relativePath = path.relative(baseDir, candidatePath);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
