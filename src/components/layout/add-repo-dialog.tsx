"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Search,
  Lock,
  Globe,
  FolderGit2,
  FolderOpen,
  Loader2,
  Github,
} from "lucide-react";
import {
  listUserRepos,
  detectBmadRepos,
  importRepo,
  importLocalFolder,
  scanLocalDirectory,
  autocompleteLocalPath,
  resolveDirectoryByContents,
} from "@/actions/repo-actions";
import type { GitHubRepo } from "@/lib/github/types";

interface AddRepoDialogProps {
  trigger?: React.ReactNode;
  importedRepos?: { owner: string; name: string }[];
  localFsEnabled?: boolean;
  githubEnabled?: boolean;
}

export function AddRepoDialog({
  trigger,
  importedRepos = [],
  localFsEnabled = false,
  githubEnabled = true,
}: AddRepoDialogProps) {
  const importedSet = useMemo(
    () => new Set(importedRepos.map((r) => `${r.owner}/${r.name}`)),
    [importedRepos]
  );
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState("");

  // Local folder state
  const [localPath, setLocalPath] = useState("");
  const [localImporting, setLocalImporting] = useState(false);
  const [localError, setLocalError] = useState("");

  const defaultTab = githubEnabled ? "github" : "local";

  const fetchRepos = useCallback(async () => {
    if (!githubEnabled) return;
    setLoading(true);
    setError("");
    setRepos([]);
    setSearch("");
    setDetecting(false);

    const result = await listUserRepos();
    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setRepos(result.data);
    setLoading(false);

    if (result.data.length > 0) {
      setDetecting(true);
      const ids = result.data.map((r) => ({
        fullName: r.fullName,
        owner: r.owner,
        name: r.name,
      }));

      const bmadResult = await detectBmadRepos(ids);
      if (bmadResult.success) {
        setRepos((prev) => {
          const updated = prev.map((r) => ({
            ...r,
            hasBmad: bmadResult.data[r.fullName] ?? false,
          }));
          updated.sort((a, b) => {
            if (a.hasBmad !== b.hasBmad) return a.hasBmad ? -1 : 1;
            return (
              new Date(b.updatedAt).getTime() -
              new Date(a.updatedAt).getTime()
            );
          });
          return updated;
        });
      }
      setDetecting(false);
    }
  }, [githubEnabled]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && githubEnabled) {
      fetchRepos();
    }
    if (!nextOpen) {
      setLocalPath("");
      setLocalError("");
      setLocalImporting(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return repos;
    const q = search.toLowerCase();
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
    );
  }, [repos, search]);

  async function handleSelectRepo(repo: GitHubRepo) {
    setImporting(repo.fullName);
    setImportError("");

    const result = await importRepo({
      owner: repo.owner,
      name: repo.name,
      description: repo.description,
      defaultBranch: repo.defaultBranch,
      fullName: repo.fullName,
    });

    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setImportError(result.error);
    }
    setImporting(null);
  }

  async function handleImportLocal(e: React.FormEvent) {
    e.preventDefault();
    if (!localPath.trim()) return;

    setLocalImporting(true);
    setLocalError("");

    const result = await importLocalFolder({ localPath: localPath.trim() });

    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setLocalError(result.error);
    }
    setLocalImporting(false);
  }

  const showTabs = githubEnabled && localFsEnabled;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" className="h-5 w-5">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
        </DialogHeader>

        {showTabs ? (
          <Tabs defaultValue={defaultTab}>
            <TabsList className="w-full">
              <TabsTrigger value="github" className="flex-1">
                <Github className="mr-1.5 h-4 w-4" />
                GitHub
              </TabsTrigger>
              <TabsTrigger value="local" className="flex-1">
                <FolderOpen className="mr-1.5 h-4 w-4" />
                Local Folder
              </TabsTrigger>
            </TabsList>
            <TabsContent value="github">
              <GitHubRepoList
                search={search}
                setSearch={setSearch}
                loading={loading}
                detecting={detecting}
                error={error}
                importError={importError}
                filtered={filtered}
                importing={importing}
                importedSet={importedSet}
                onSelect={handleSelectRepo}
              />
            </TabsContent>
            <TabsContent value="local">
              <LocalFolderForm
                localPath={localPath}
                setLocalPath={setLocalPath}
                localImporting={localImporting}
                localError={localError}
                onSubmit={handleImportLocal}
              />
            </TabsContent>
          </Tabs>
        ) : localFsEnabled ? (
          <LocalFolderForm
            localPath={localPath}
            setLocalPath={setLocalPath}
            localImporting={localImporting}
            localError={localError}
            onSubmit={handleImportLocal}
          />
        ) : (
          <GitHubRepoList
            search={search}
            setSearch={setSearch}
            loading={loading}
            detecting={detecting}
            error={error}
            importError={importError}
            filtered={filtered}
            importing={importing}
            importedSet={importedSet}
            onSelect={handleSelectRepo}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GitHubRepoList({
  search,
  setSearch,
  loading,
  detecting,
  error,
  importError,
  filtered,
  importing,
  importedSet,
  onSelect,
}: {
  search: string;
  setSearch: (v: string) => void;
  loading: boolean;
  detecting: boolean;
  error: string;
  importError: string;
  filtered: GitHubRepo[];
  importing: string | null;
  importedSet: Set<string>;
  onSelect: (repo: GitHubRepo) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <Input
          placeholder="Search for a repository..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          disabled={loading}
        />
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {importError && <p className="text-destructive text-sm">{importError}</p>}
      {detecting && (
        <p className="text-muted-foreground text-xs animate-pulse">
          Detecting BMAD files...
        </p>
      )}

      <ScrollArea className="h-80">
        {loading ? (
          <div className="space-y-3 p-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <Skeleton className="h-8 w-8 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1 p-1">
            {filtered.length === 0 && !error && (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {search ? "No repository found" : "No repository available"}
              </p>
            )}
            {filtered.map((repo) => {
              const isImporting = importing === repo.fullName;
              const isAlreadyImported = importedSet.has(
                `${repo.owner}/${repo.name}`
              );
              const isDisabled = importing !== null || isAlreadyImported;

              return (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => onSelect(repo)}
                  disabled={isDisabled}
                  className="hover:bg-accent flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-50"
                >
                  {isImporting ? (
                    <Loader2 className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0 animate-spin" />
                  ) : (
                    <FolderGit2 className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {repo.fullName}
                      </span>
                      {isAlreadyImported && (
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          Imported
                        </Badge>
                      )}
                      {repo.hasBmad && !isAlreadyImported && (
                        <Badge variant="default" className="shrink-0 text-xs">
                          BMAD
                        </Badge>
                      )}
                      {repo.isPrivate ? (
                        <Lock className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <Globe className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                      )}
                    </div>
                    {repo.description && (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs [text-wrap:auto]">
                        {repo.description}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function PathInput({
  value,
  onChange,
  disabled,
  placeholder,
  onSelect,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onSelect?: (v: string) => void;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function fetchSuggestions(partial: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!partial.trim()) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await autocompleteLocalPath({ partial });
      if (res.success && res.data.dirs.length > 0) {
        setSuggestions(res.data.dirs);
        setOpen(true);
        setActiveIdx(-1);
      } else {
        setSuggestions([]);
        setOpen(false);
      }
    }, 220);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
    fetchSuggestions(e.target.value);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      pick(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Tab" && activeIdx >= 0) {
      e.preventDefault();
      pick(suggestions[activeIdx]);
    }
  }

  function pick(dir: string) {
    const withSlash = dir.endsWith("/") ? dir : dir + "/";
    onChange(withSlash);
    onSelect?.(withSlash);
    setSuggestions([]);
    setOpen(false);
    fetchSuggestions(withSlash);
  }

  function handleBrowseClick() {
    fileInputRef.current?.click();
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const firstFile = files[0];
    // Non-standard .path property available in Electron and some local envs
    const absoluteFilePath: string | undefined = (firstFile as File & { path?: string }).path;
    if (absoluteFilePath) {
      // Derive folder path by stripping the relative sub-path below the picked root
      const relParts = firstFile.webkitRelativePath.split("/");
      // absoluteFilePath ends with webkitRelativePath (OS sep = /)
      // folderPath = the part before webkitRelativePath, then append the root folder name
      const base = absoluteFilePath.slice(0, absoluteFilePath.length - firstFile.webkitRelativePath.length);
      const folderPath = (base + relParts[0]).replace(/\/$/, "");
      onChange(folderPath);
      fetchSuggestions(folderPath);
    } else {
      // Fallback: only name + file listing available from the browser
      const folderName = firstFile.webkitRelativePath.split("/")[0];
      onChange(folderName);

      // Collect immediate children of the picked folder as a content fingerprint
      const immediateChildren = new Set<string>();
      for (let i = 0; i < files.length; i++) {
        const parts = files[i].webkitRelativePath.split("/");
        if (parts.length >= 2) immediateChildren.add(parts[1]);
      }

      const res = await resolveDirectoryByContents({
        name: folderName,
        entries: [...immediateChildren],
      });
      if (res.success && res.data.length >= 1) {
        // Best match (highest fingerprint score) goes first
        onChange(res.data[0]);
        if (res.data.length > 1) {
          // Show remaining candidates as suggestions in case user wants to pick
          setSuggestions(res.data);
          setOpen(true);
          setActiveIdx(-1);
        } else {
          onSelect?.(res.data[0]);
        }
      } else {
        // No match found: keep the name and let user complete via autocomplete
        fetchSuggestions(folderName);
      }
    }
    e.target.value = "";
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <div className="flex gap-1.5">
        <Input
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => value.trim() && suggestions.length > 0 && setOpen(true)}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          disabled={disabled}
          onClick={handleBrowseClick}
          title="Browse for folder"
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({ webkitdirectory: "", directory: "" } as any)}
        onChange={handleFileInput}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-52 overflow-auto text-sm">
          {suggestions.map((dir, i) => (
            <li
              key={dir}
              onMouseDown={(e) => { e.preventDefault(); pick(dir); }}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${
                i === activeIdx ? "bg-accent" : "hover:bg-accent/60"
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{dir}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LocalFolderForm({
  localPath,
  setLocalPath,
  localImporting,
  localError,
  onSubmit,
}: {
  localPath: string;
  setLocalPath: (v: string) => void;
  localImporting: boolean;
  localError: string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const [mode, setMode] = useState<"direct" | "scan">("scan");
  const [scanPath, setScanPath] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanResults, setScanResults] = useState<{ path: string; name: string }[] | null>(null);

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!scanPath.trim()) return;
    setScanning(true);
    setScanError("");
    setScanResults(null);
    const result = await scanLocalDirectory({ parentPath: scanPath.trim() });
    if (result.success) {
      setScanResults(result.data);
      if (result.data.length === 0) setScanError("No BMAD projects found in this directory.");
    } else {
      setScanError(result.error);
    }
    setScanning(false);
  }

  function handleSelectScanned(p: string) {
    setLocalPath(p);
    setMode("direct");
    setScanResults(null);
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode("scan")}
          className={`px-2 py-1 rounded transition-colors ${
            mode === "scan"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Scan directory
        </button>
        <button
          type="button"
          onClick={() => setMode("direct")}
          className={`px-2 py-1 rounded transition-colors ${
            mode === "direct"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Enter path directly
        </button>
      </div>

      {mode === "scan" ? (
        <div className="space-y-3">
          <form onSubmit={handleScan} className="flex gap-2 items-start">
            <PathInput
              value={scanPath}
              onChange={setScanPath}
              disabled={scanning}
              placeholder="/Users/you/Documents/GitHub"
              className="flex-1"
            />
            <Button type="submit" disabled={scanning || !scanPath.trim()} size="sm" className="shrink-0">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </form>
          {scanError && <p className="text-destructive text-sm">{scanError}</p>}
          {scanResults && scanResults.length > 0 && (
            <ScrollArea className="h-52">
              <div className="space-y-1 pr-2">
                {scanResults.map((r) => (
                  <button
                    key={r.path}
                    type="button"
                    onClick={() => handleSelectScanned(r.path)}
                    className="hover:bg-accent flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
                  >
                    <FolderOpen className="text-muted-foreground h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.path}</p>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <PathInput
            value={localPath}
            onChange={setLocalPath}
            disabled={localImporting}
            placeholder="/home/user/my-project"
          />
          {localError && <p className="text-destructive text-sm">{localError}</p>}
          <Button type="submit" className="w-full" disabled={localImporting || !localPath.trim()}>
            {localImporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="mr-2 h-4 w-4" />
            )}
            Import local folder
          </Button>
        </form>
      )}
    </div>
  );
}
