import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectHotkeyBindings } from '@features/hotkeys/hotkeysSlice';
import { formatBindingForDisplay } from '@features/hotkeys/keyMatcher';

const ITEMS: Array<{ id: string; label: string }> = [
  { id: 'openFilters', label: 'serverView.filters' },
  { id: 'loadAll', label: 'serverView.loadAll' },
  { id: 'openExport', label: 'serverView.export' },
  { id: 'openAnalytics', label: 'serverView.analytics' },
  { id: 'toggleFocus', label: 'serverView.focus' },
  { id: 'openReference', label: 'simple.allKeys' },
];

/** The hint bar (Simple): the current bindings for the common actions, read from the hotkeys slice so rebinding shows here too. */
const SimpleHintBar = () => {
  const { t } = useTranslation();
  const bindings = useAppSelector(selectHotkeyBindings);
  return (
    <Box data-testid="simple-hint-bar" sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2.5, height: 32, borderTop: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', flexShrink: 0 }}>
      {ITEMS.map((i) => {
        const key = (bindings as Record<string, string | null | undefined>)[i.id];
        if (!key) return null;
        return (
          <Typography key={i.id} variant="caption" sx={{ color: 'text.secondary', display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
            <Box component="kbd" sx={{ fontFamily: 'inherit', fontSize: '0.65rem', border: '1px solid', borderColor: 'divider', borderRadius: 0.5, px: 0.6, color: 'text.primary' }}>{formatBindingForDisplay(key)}</Box>
            {t(i.label)}
          </Typography>
        );
      })}
    </Box>
  );
};

export default SimpleHintBar;
