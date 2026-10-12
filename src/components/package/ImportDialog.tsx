import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Typography,
} from '@mui/material';
import {
  Archive as ArchiveIcon,
  CloudUpload as UploadIcon,
} from '@mui/icons-material';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  importPackage,
  selectImportProgress,
  selectPackageError,
  selectPackageStatus,
} from '@features/package/packageSlice';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

/**
 * Translate the raw browser/parse error into plain language. Casual reporters
 * (#203 dokahime, #210 dollifiedgirl) hit opaque DOMException text and asked
 * "what does this mean?" — map the two known import failure families to
 * actionable copy and pass anything else through unchanged.
 */
export function friendlyImportError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes('out of memory') ||
    lower.includes('cannot be cloned') ||
    lower.includes('allocation failed')
  ) {
    // #210: the worker-clone / V8-allocation OOM family.
    return 'Your browser ran out of memory while reading the package. Close other tabs and try again, or open Discrub in a desktop browser with more available memory.';
  }
  if (
    lower.includes('could not be read') ||
    lower.includes('notreadable') ||
    lower.includes('permission problems')
  ) {
    // #203: stale/locked file-descriptor read failure.
    return 'Couldn’t read the ZIP file. Make sure it isn’t open in another program, then try again. If it’s kept in a cloud-synced folder (OneDrive, iCloud, Dropbox), copy it to your Desktop first.';
  }
  if (lower.includes('quotaexceeded') || lower.includes('exceeded the quota') || lower.includes('not enough space')) {
    // #269: IndexedDB refused the write.
    return 'Your browser does not have enough storage space for this package. Free up disk space or close the package you already have loaded, then try again.';
  }
  return raw;
}

const ImportDialog = ({ open, onClose, onImported }: ImportDialogProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectPackageStatus);
  const error = useAppSelector(selectPackageError);
  const importProgress = useAppSelector(selectImportProgress);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isParsing = status === 'parsing';

  const handleFile = useCallback(
    async (file: File) => {
      // #269: the File goes to the import as-is. The reader streams it
      // in chunks, so a multi-GB package never has to fit in one buffer
      // (Chrome refuses `arrayBuffer()` past about 2 GiB) and a flaky
      // read (#203) is retried inside the import.
      const result = await dispatch(importPackage(file));
      if (importPackage.fulfilled.match(result)) {
        onImported?.();
        onClose();
      }
    },
    [dispatch, onImported, onClose],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  return (
    <Dialog open={open} onClose={isParsing ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 5 }}>
        <ArchiveIcon color="primary" />
        {t('package.importDialogTitle')}
        <DialogCloseIcon
          onClose={onClose}
          disabled={isParsing}
          label={t('package.importDialogClose')}
        />
      </DialogTitle>

      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('package.importDialogIntro')}
        </Typography>

        <Box
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => !isParsing && inputRef.current?.click()}
          role="button"
          aria-label={t('package.importDialogUpload')}
          tabIndex={isParsing ? -1 : 0}
          sx={{
            border: '2px dashed',
            borderColor: isDragging ? 'primary.main' : 'divider',
            borderRadius: 2,
            p: 4,
            textAlign: 'center',
            cursor: isParsing ? 'default' : 'pointer',
            backgroundColor: isDragging ? 'action.hover' : 'transparent',
            transition: 'all 150ms ease',
            '&:hover': {
              borderColor: isParsing ? 'divider' : 'primary.main',
              backgroundColor: isParsing ? 'transparent' : 'action.hover',
            },
          }}
        >
          {isParsing ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              {importProgress && importProgress.total > 0 ? (
                <Box sx={{ width: '100%', maxWidth: 360 }}>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, Math.round((importProgress.read / importProgress.total) * 100))}
                    data-testid="package-import-progress"
                  />
                </Box>
              ) : (
                <CircularProgress size={32} />
              )}
              <Typography variant="body2" color="text.secondary">
                {importProgress && importProgress.total > 0
                  ? t('package.readingPackage', { pct: Math.min(100, Math.round((importProgress.read / importProgress.total) * 100)) })
                  : t('package.parsingPackage')}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <UploadIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {t('package.dropZip')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('package.onlyPackage')}
              </Typography>
            </Box>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={handleInputChange}
            data-testid="package-file-input"
          />
        </Box>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {friendlyImportError(error)}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={isParsing}>
          {t('common.cancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ImportDialog;
