"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  FolderInput,
  Info,
  Loader2,
  MonitorDot,
} from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { InputGroupButton } from "@/components/ui/input-group"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DirectoryBrowser,
  type DirectoryBrowserHandle,
} from "@/components/shared/directory-browser"
import { checkDirectoriesExist } from "@/lib/api"
import {
  toLocalizedErrorMessage,
  type AppErrorTranslator,
} from "@/lib/app-error"
import { parentFsPath } from "@/lib/path-utils"
import { isDesktop, openFileDialog } from "@/lib/platform"
import { getActiveRemoteConnectionId } from "@/lib/transport"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"

interface RelocateFolderDialogProps {
  folderId: number | null
  onOpenChange: (open: boolean) => void
}

function buildAncestorCandidates(path: string): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  let cur: string | null = path
  for (let i = 0; i < 32; i++) {
    const parent = parentFsPath(cur ?? "")
    if (!parent || seen.has(parent)) break
    seen.add(parent)
    candidates.push(parent)
    cur = parent
  }
  return candidates
}

/**
 * Dialog for relocating a workspace folder whose path was removed or moved on
 * disk. Updating the path preserves all historical conversations and lets them
 * continue under the new directory.
 */
export function RelocateFolderDialog({
  folderId,
  onOpenChange,
}: RelocateFolderDialogProps) {
  const t = useTranslations("Folder.relocate")
  const tWorkspaceDialog = useTranslations("Folder.workspaceDialog")
  const tBrowser = useTranslations("DirectoryBrowser")
  const tRoot = useTranslations()

  const folder = useAppWorkspaceStore((s) =>
    folderId != null
      ? (s.allFolders.find((f) => f.id === folderId) ?? null)
      : null
  )
  const relocateFolder = useAppWorkspaceStore((s) => s.relocateFolder)

  const open = folderId != null && folder != null
  const [targetPath, setTargetPath] = useState("")
  const [initialPath, setInitialPath] = useState<string | undefined>(undefined)
  const [initialResolved, setInitialResolved] = useState(false)
  const [browserBusy, setBrowserBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const browserRef = useRef<DirectoryBrowserHandle>(null)

  const nativePickerAvailable =
    isDesktop() && getActiveRemoteConnectionId() === null

  const folderPath = folder?.path ?? ""

  useEffect(() => {
    if (!open || !folderPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- session reset when dialog closes
      setInitialResolved(false)
      setInitialPath(undefined)
      setTargetPath("")
      setSubmitError(null)
      setSubmitting(false)
      return
    }
    let cancelled = false
    setInitialResolved(false)
    setInitialPath(undefined)
    setTargetPath("")
    setSubmitError(null)
    setSubmitting(false)

    const resolveStart = async () => {
      let resolved: string | undefined
      const candidates = buildAncestorCandidates(folderPath)
      if (candidates.length > 0) {
        try {
          const existsMap = await checkDirectoriesExist(candidates)
          resolved = candidates.find((p) => existsMap[p] === true)
        } catch {
          resolved = undefined
        }
      }
      if (cancelled) return
      setInitialPath(resolved)
      setInitialResolved(true)
    }

    void resolveStart()
    return () => {
      cancelled = true
    }
  }, [open, folderPath])

  const commitRelocate = useCallback(
    async (selectedPath: string) => {
      if (!folder) return
      setSubmitting(true)
      setSubmitError(null)
      try {
        const updated = await relocateFolder(folder.id, selectedPath)
        toast.success(
          t("relocatedToast", {
            name: updated.name,
            path: updated.path,
          })
        )
        onOpenChange(false)
      } catch (err) {
        setSubmitError(
          toLocalizedErrorMessage(err, tRoot as unknown as AppErrorTranslator)
        )
      } finally {
        setSubmitting(false)
      }
    },
    [folder, relocateFolder, t, tRoot, onOpenChange]
  )

  const handleConfirm = useCallback(async () => {
    if (submitting || browserBusy) return
    const selected = await browserRef.current?.confirm()
    if (selected) {
      await commitRelocate(selected)
    }
  }, [submitting, browserBusy, commitRelocate])

  const handleNativePick = useCallback(async () => {
    const selected = await openFileDialog({ directory: true, multiple: false })
    if (!selected) return
    const path = Array.isArray(selected) ? selected[0] : selected
    if (path) {
      setTargetPath(path)
      setSubmitError(null)
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="size-4 text-muted-foreground" aria-hidden />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {folder ? (
          <div className="space-y-2">
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-medium text-muted-foreground">
                {t("currentPathLabel")}
              </div>
              <div
                className="mt-0.5 truncate font-mono text-xs text-foreground"
                title={folder.path}
              >
                {folder.path}
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-muted-foreground">
              <Info
                className="mt-0.5 size-3.5 shrink-0 text-blue-500"
                aria-hidden
              />
              <span>{t("historyPreservedNote")}</span>
            </div>

            {submitError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 break-words">
                  {submitError}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <DirectoryBrowser
          ref={browserRef}
          active={open && initialResolved}
          initialPath={initialPath}
          value={targetPath}
          onValueChange={(nextPath) => {
            setTargetPath(nextPath)
            if (submitError) setSubmitError(null)
          }}
          onQuickSelect={commitRelocate}
          onBusyChange={setBrowserBusy}
          allowCreateFolder
          pathInputAction={
            nativePickerAvailable ? (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InputGroupButton
                      size="icon-xs"
                      variant="ghost"
                      type="button"
                      onClick={handleNativePick}
                      disabled={submitting}
                      aria-label={tWorkspaceDialog("useSystemPicker")}
                    >
                      <MonitorDot className="size-3.5" />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    {tWorkspaceDialog("useSystemPicker")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null
          }
        />

        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {tBrowser("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!targetPath.trim() || submitting || browserBusy}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
