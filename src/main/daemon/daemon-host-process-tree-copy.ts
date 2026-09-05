import { join, win32 as winPath } from 'node:path'

export type DaemonHostProcessTreeCopy = {
  sourcePath: string
  destRel: string
  kind: 'dir'
  optional: true
  filter: (sourcePath: string) => boolean
}

const HOST_PROCESS_TREE_BIN = `win32-${process.arch}-${process.versions.modules}`.toLowerCase()

function isRuntimeWindowsProcessTreePath(sourcePath: string): boolean {
  const path = sourcePath.toLowerCase()
  const binaryDir = path.match(/bin[\\/]([^\\/]+)/)
  return !path.endsWith('.pdb') && (!binaryDir || binaryDir[1] === HOST_PROCESS_TREE_BIN)
}

export function buildWindowsProcessTreeCopy(
  appDir: string,
  resourcesPath: string
): DaemonHostProcessTreeCopy {
  const sourcePath = join(resourcesPath, 'node_modules', '@vscode', 'windows-process-tree')
  return {
    sourcePath,
    destRel: winPath.relative(appDir, sourcePath).split(winPath.sep).join('/'),
    kind: 'dir',
    optional: true,
    filter: isRuntimeWindowsProcessTreePath
  }
}
