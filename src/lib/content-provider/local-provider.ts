import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import {
  BMAD_CORE_DIR,
  BMAD_IMPLEMENTATION_DIR,
  BMAD_OUTPUT_DIR,
  BMAD_PLANNING_DIR,
} from "@/lib/bmad/utils";
import {
  assertSafeRelativePath,
  resolveSafePathWithinRoot,
} from "@/lib/content-provider/path-safety";
import type { ContentProvider, ContentProviderTree } from "./types";
import { LOCAL_PROVIDER_DEFAULTS } from "./types";

interface LocalProviderOptions {
  maxFileSizeBytes?: number;
  maxFileCount?: number;
  maxDepth?: number;
}

interface ScanRoot {
  virtualRoot: string;
  absoluteRoot: string;
}

interface LocalScanContext {
  projectRoot: string;
  rootDirectories: string[];
  scanRoots: ScanRoot[];
}

interface LocalDirInfo {
  dirNames: string[];
  hasArtifacts: boolean;
  hasDocs: boolean;
  outputDirName: string | null;
}

export class LocalProvider implements ContentProvider {
  private resolvedRoot: string;
  private maxFileSizeBytes: number;
  private maxFileCount: number;
  private maxDepth: number;
  private scanContextPromise: Promise<LocalScanContext> | null = null;

  constructor(rootPath: string, options?: LocalProviderOptions) {
    // Guard 1 — Feature flag
    if (process.env.ENABLE_LOCAL_FS !== "true") {
      throw new Error("LOCAL_DISABLED");
    }

    this.resolvedRoot = path.resolve(rootPath);
    this.maxFileSizeBytes =
      options?.maxFileSizeBytes ?? LOCAL_PROVIDER_DEFAULTS.maxFileSizeBytes;
    this.maxFileCount =
      options?.maxFileCount ?? LOCAL_PROVIDER_DEFAULTS.maxFileCount;
    this.maxDepth = options?.maxDepth ?? LOCAL_PROVIDER_DEFAULTS.maxDepth;
  }

  async validateRoot(): Promise<void> {
    try {
      await fs.access(this.resolvedRoot, constants.R_OK);
    } catch {
      throw new Error("PATH_NOT_FOUND");
    }

    const stat = await fs.stat(this.resolvedRoot);
    if (!stat.isDirectory()) {
      throw new Error("PATH_NOT_FOUND");
    }
  }

  async getProjectRoot(): Promise<string> {
    return (await this.getScanContext()).projectRoot;
  }

  /** Directories skipped during tree scan (not relevant to BMAD projects). */
  private static IGNORED_DIRS = new Set([
    "node_modules",
    ".git",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "dist",
    "build",
    ".cache",
    ".turbo",
    ".vercel",
    ".output",
    "__pycache__",
    ".venv",
    "venv",
    "target",
    ".now",
  ]);

  private async getScanContext(): Promise<LocalScanContext> {
    if (!this.scanContextPromise) {
      this.scanContextPromise = this.buildScanContext();
    }
    return this.scanContextPromise;
  }

  private async buildScanContext(): Promise<LocalScanContext> {
    await this.validateRoot();

    const inputInfo = await this.readDirInfo(this.resolvedRoot);
    const inputBase = path.basename(this.resolvedRoot);
    let projectRoot = this.resolvedRoot;
    let projectInfo = inputInfo;

    const parentRoot = path.dirname(this.resolvedRoot);
    if (
      parentRoot !== this.resolvedRoot &&
      (inputBase === BMAD_CORE_DIR ||
        inputBase === BMAD_OUTPUT_DIR ||
        inputInfo.hasArtifacts)
    ) {
      try {
        const parentInfo = await this.readDirInfo(parentRoot);
        if (
          this.shouldUseParentProjectRoot(inputBase, inputInfo, parentInfo)
        ) {
          projectRoot = parentRoot;
          projectInfo = parentInfo;
        }
      } catch {
        // Ignore parent probing errors and keep the current root.
      }
    }

    const scanRoots = this.buildVirtualRootsFromProjectRoot(projectRoot, projectInfo);

    if (scanRoots.length === 0 && inputInfo.hasArtifacts) {
      const virtualRoot = inputBase || BMAD_OUTPUT_DIR;
      return {
        projectRoot,
        rootDirectories: [virtualRoot],
        scanRoots: [{ virtualRoot, absoluteRoot: this.resolvedRoot }],
      };
    }

    return {
      projectRoot,
      rootDirectories: scanRoots.map((root) => root.virtualRoot),
      scanRoots,
    };
  }

  private buildVirtualRootsFromProjectRoot(
    projectRoot: string,
    projectInfo: LocalDirInfo,
  ): ScanRoot[] {
    const scanRoots: ScanRoot[] = [];

    if (projectInfo.dirNames.includes(BMAD_CORE_DIR)) {
      this.pushScanRoot(scanRoots, BMAD_CORE_DIR, path.join(projectRoot, BMAD_CORE_DIR));
    }

    if (projectInfo.outputDirName) {
      this.pushScanRoot(
        scanRoots,
        projectInfo.outputDirName,
        path.join(projectRoot, projectInfo.outputDirName),
      );
    }

    const docsDirName = projectInfo.dirNames.find(
      (dirName) => dirName.toLowerCase() === "docs",
    );
    if (docsDirName) {
      this.pushScanRoot(scanRoots, docsDirName, path.join(projectRoot, docsDirName));
    }

    return scanRoots;
  }

  private shouldUseParentProjectRoot(
    inputBase: string,
    inputInfo: LocalDirInfo,
    parentInfo: LocalDirInfo,
  ): boolean {
    if (inputBase === BMAD_CORE_DIR) {
      return true;
    }

    if (inputBase === BMAD_OUTPUT_DIR) {
      return true;
    }

    if (inputInfo.hasArtifacts) {
      return parentInfo.dirNames.includes(BMAD_CORE_DIR) || parentInfo.hasDocs;
    }

    return false;
  }

  private async readDirInfo(dirPath: string): Promise<LocalDirInfo> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const dirNames = entries
      .filter((entry) => !entry.isSymbolicLink() && entry.isDirectory())
      .map((entry) => entry.name);

    return {
      dirNames,
      hasArtifacts:
        dirNames.includes(BMAD_PLANNING_DIR) ||
        dirNames.includes(BMAD_IMPLEMENTATION_DIR),
      hasDocs: dirNames.some((dirName) => dirName.toLowerCase() === "docs"),
      outputDirName: await this.resolveOutputDirName(dirPath, dirNames),
    };
  }

  private async resolveOutputDirName(
    rootPath: string,
    dirNames: string[],
  ): Promise<string | null> {
    if (dirNames.includes(BMAD_OUTPUT_DIR)) {
      return BMAD_OUTPUT_DIR;
    }

    for (const dirName of dirNames) {
      if (dirName === BMAD_CORE_DIR) continue;
      if (await this.directoryHasArtifacts(path.join(rootPath, dirName))) {
        return dirName;
      }
    }

    return null;
  }

  private async directoryHasArtifacts(dirPath: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const dirNames = entries
        .filter((entry) => !entry.isSymbolicLink() && entry.isDirectory())
        .map((entry) => entry.name);
      return (
        dirNames.includes(BMAD_PLANNING_DIR) ||
        dirNames.includes(BMAD_IMPLEMENTATION_DIR)
      );
    } catch {
      return false;
    }
  }

  private pushScanRoot(
    scanRoots: ScanRoot[],
    virtualRoot: string,
    absoluteRoot: string,
  ): void {
    if (scanRoots.some((scanRoot) => scanRoot.virtualRoot === virtualRoot)) {
      return;
    }
    scanRoots.push({ virtualRoot, absoluteRoot });
  }

  async getTree(): Promise<ContentProviderTree> {
    const { rootDirectories, scanRoots } = await this.getScanContext();
    const paths: string[] = [];
    let fileCount = 0;

    // Step 2: Walk all non-ignored root directories for file paths
    const walk = async (
      scanRoot: ScanRoot,
      dir: string,
      depth: number,
      relativeDir = "",
    ) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const dirent of entries) {
        // Guard 3 — Symlink detection: skip symlinks
        if (dirent.isSymbolicLink()) {
          continue;
        }

        if (dirent.isDirectory()) {
          // Skip ignored directories
          if (LocalProvider.IGNORED_DIRS.has(dirent.name)) {
            continue;
          }

          // Guard 6 — Depth limit
          if (depth < this.maxDepth) {
            const childRelativeDir = relativeDir
              ? path.join(relativeDir, dirent.name)
              : dirent.name;
            await walk(scanRoot, path.join(dir, dirent.name), depth + 1, childRelativeDir);
          }
          continue;
        }

        if (!dirent.isFile()) {
          continue;
        }

        // Guard 5 — File count limit
        fileCount++;
        if (fileCount > this.maxFileCount) {
          throw new Error(
            `File count exceeds limit of ${this.maxFileCount}`
          );
        }

        const relativePath = relativeDir
          ? path.join(relativeDir, dirent.name)
          : dirent.name;
        paths.push(path.join(scanRoot.virtualRoot, relativePath));
      }
    };

    for (const scanRoot of scanRoots) {
      await walk(scanRoot, scanRoot.absoluteRoot, 1);
    }

    return { paths, rootDirectories };
  }

  async getFileContent(filePath: string): Promise<string> {
    const fullPath = await this.resolveVirtualPath(filePath);

    // Guard 3 — Symlink detection via lstat
    const lstat = await fs.lstat(fullPath);
    if (lstat.isSymbolicLink()) {
      throw new Error("Symlinks are not allowed");
    }

    // Guard 4 — File size limit
    if (lstat.size > this.maxFileSizeBytes) {
      throw new Error(
        `File size ${lstat.size} exceeds limit of ${this.maxFileSizeBytes} bytes`
      );
    }

    return fs.readFile(fullPath, "utf-8");
  }

  private async resolveVirtualPath(filePath: string): Promise<string> {
    assertSafeRelativePath(filePath);

    const segments = filePath.split(/[\\/]+/).filter(Boolean);
    const [firstSegment, ...restSegments] = segments;
    const { scanRoots } = await this.getScanContext();
    const scanRoot = scanRoots.find((candidate) => candidate.virtualRoot === firstSegment);

    if (!scanRoot) {
      throw new Error("Access denied: only BMAD directories are accessible");
    }

    return resolveSafePathWithinRoot(scanRoot.absoluteRoot, restSegments.join(path.sep));
  }
}
