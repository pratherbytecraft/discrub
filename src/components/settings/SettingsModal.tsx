import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tabs,
  Tab,
  Box,
  Alert,
  Stack,
  Typography,
} from '@mui/material';
import type { AppSettings } from 'discrub-core/types/discrub-types';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSettings, updateAllSettings, defaultSettings } from '@features/app/appSlice';
import {
  selectHotkeys,
  setAllHotkeys,
} from '@features/hotkeys/hotkeysSlice';
import type { HotkeysState } from '@features/hotkeys/types';
import { getDiscordService } from '@services/discordService';
import { validateSettings } from './settingsUtils';
import { OperationDelaysTab } from './tabs/OperationDelaysTab';
import { ExportPreferencesTab } from './tabs/ExportPreferencesTab';
import { UserDataTab } from './tabs/UserDataTab';
import { DisplayTab } from './tabs/DisplayTab';
import { PurgeTab } from './tabs/PurgeTab';
import { HotkeysTab } from './tabs/HotkeysTab';
import ResetDiscrubButton from './ResetDiscrubButton';
import { forgetRememberedToken, selectTokenRemembered } from '@features/auth/authSlice';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { hasUnsavedSettingsChanges } from './dirtyDetection';
import { CheckCircleOutline } from '@mui/icons-material';
import { useFullScreenDialog } from '@/hooks/useFullScreenDialog';
import { useTranslation } from 'react-i18next';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel = ({ children, value, index }: TabPanelProps) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
    >
      {value === index && <Box sx={{ pt: 1.5 }}>{children}</Box>}
    </div>
  );
};

const SettingsModal = ({ open, onClose }: SettingsModalProps) => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const settings = useAppSelector(selectSettings);
  const tokenRemembered = useAppSelector(selectTokenRemembered);
  const hotkeys = useAppSelector(selectHotkeys);
  const [formValues, setFormValues] = useState<AppSettings>(settings || defaultSettings);
  // Hotkeys live in their own slice with immediate-apply thunks, but
  // the dialog batches edits the same way it batches AppSettings:
  // changes accumulate locally until "Save Settings" commits both at
  // once. Single Save story across the whole modal (#144 follow-up
  // to remove the per-row Save buttons).
  const [formHotkeys, setFormHotkeys] = useState<HotkeysState>(hotkeys);
  const [activeTab, setActiveTab] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // #260: Save keeps the dialog open (people keep editing after a save)
  // and confirms inline instead. Cleared by the next edit or close.
  const [justSaved, setJustSaved] = useState(false);
  // Discard-confirmation dialog state (#164). Shown only when the
  // user attempts to close while there are unsaved edits — otherwise
  // close skips the prompt entirely so the typical "open, peek, close"
  // flow stays one click.
  const [discardPromptOpen, setDiscardPromptOpen] = useState(false);

  // Seed the form from Redux when the modal opens, and follow later
  // settings changes only while the form is untouched. A background
  // setting write while the dialog is open (the announcement fetch
  // caching its revision right after login, a user-map refresh) used to
  // reseed the form and silently drop an in-progress edit (#256).
  const formValuesRef = useRef(formValues);
  const formHotkeysRef = useRef(formHotkeys);
  formValuesRef.current = formValues;
  formHotkeysRef.current = formHotkeys;
  const seededRef = useRef<{ settings: AppSettings; hotkeys: HotkeysState } | null>(null);
  useEffect(() => {
    if (!open) {
      seededRef.current = null;
      setJustSaved(false);
      return;
    }
    const next = settings || defaultSettings;
    const seeded = seededRef.current;
    const edited = seeded !== null && hasUnsavedSettingsChanges({
      formValues: formValuesRef.current,
      settings: seeded.settings,
      formHotkeys: formHotkeysRef.current,
      hotkeys: seeded.hotkeys,
    });
    if (edited) return;
    setFormValues(next);
    setFormHotkeys(hotkeys);
    setErrors([]);
    seededRef.current = { settings: next, hotkeys };
  }, [settings, hotkeys, open]);

  const handleChange = (key: DiscrubSetting, value: string) => {
    setFormValues((prev) => ({
      ...prev,
      [key]: value,
    }));
    setJustSaved(false);
    // Clear errors when user makes changes
    if (errors.length > 0) {
      setErrors([]);
    }
  };

  const handleHotkeysChange = (next: HotkeysState) => {
    setFormHotkeys(next);
    setJustSaved(false);
  };

  const handleSave = async () => {
    // Validate settings
    const validationErrors = validateSettings(formValues);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSaving(true);
    try {
      // Save settings to Redux and localStorage
      await dispatch(updateAllSettings(formValues)).unwrap();

      // Save hotkeys batch — same Save click, single commit point.
      await dispatch(setAllHotkeys(formHotkeys)).unwrap();

      // Reinitialize Discord service with new settings
      getDiscordService(formValues);

      // Stay open and confirm inline (#260). The saved values are the new
      // dirty baseline, so Cancel and X close without the discard prompt
      // and a later background write can reseed an untouched form.
      seededRef.current = { settings: formValues, hotkeys: formHotkeys };
      setJustSaved(true);
    } catch {
      setErrors([t('settings.saveFailed')]);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    // Theme choices live in the Themes hub, not this form, so a bulk
    // reset must not silently revert them through the batch save.
    setFormValues({
      ...defaultSettings,
      [DiscrubSetting.APP_THEME_MODE]:
        formValues[DiscrubSetting.APP_THEME_MODE] ?? defaultSettings[DiscrubSetting.APP_THEME_MODE],
      [DiscrubSetting.APP_THEME_ANIMATIONS]:
        formValues[DiscrubSetting.APP_THEME_ANIMATIONS] ??
        defaultSettings[DiscrubSetting.APP_THEME_ANIMATIONS],
    });
    setErrors([]);
    setJustSaved(false);
  };

  // Actually discard edits + close. Routed through whenever close is
  // approved (no unsaved edits, or user clicked Discard in the prompt).
  const performClose = () => {
    setFormValues(settings || defaultSettings);
    setFormHotkeys(hotkeys);
    setErrors([]);
    setDiscardPromptOpen(false);
    onClose();
  };

  // Public close-request entry point. Wired to Cancel, the X icon,
  // backdrop click, and Esc. After a successful Save the form equals
  // the stored settings, so these close without the discard prompt.
  const handleClose = () => {
    const dirty = hasUnsavedSettingsChanges({
      formValues,
      settings: settings || defaultSettings,
      formHotkeys,
      hotkeys,
    });
    if (dirty) {
      setDiscardPromptOpen(true);
      return;
    }
    performClose();
  };

  const fullScreen = useFullScreenDialog();
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      fullScreen={fullScreen}
      PaperProps={{
        sx: fullScreen ? undefined : { height: '80vh', maxHeight: 600 },
      }}
    >
      <DialogTitle sx={{ pr: 5 }}>
        {t('settings.title')}
        <DialogCloseIcon onClose={handleClose} disabled={saving} />
      </DialogTitle>
      <DialogContent sx={{ overflow: 'auto' }}>
        {errors.length > 0 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errors.map((error, index) => (
              <div key={index}>{error}</div>
            ))}
          </Alert>
        )}

        <Tabs
          value={activeTab}
          onChange={(_, newValue) => setActiveTab(newValue)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label={t('settings.tabOperationDelays')} />
          <Tab label={t('settings.tabExportPreferences')} />
          <Tab label={t('settings.tabUserData')} />
          <Tab label={t('settings.tabDisplay')} />
          <Tab label={t('settings.tabPurgeBehavior')} />
          <Tab label={t('settings.tabHotkeys')} />
          <Tab label={t('settings.tabReset')} />
        </Tabs>

        <TabPanel value={activeTab} index={0}>
          <OperationDelaysTab formValues={formValues} onChange={handleChange} />
        </TabPanel>

        <TabPanel value={activeTab} index={1}>
          <ExportPreferencesTab formValues={formValues} onChange={handleChange} />
        </TabPanel>

        <TabPanel value={activeTab} index={2}>
          <UserDataTab formValues={formValues} onChange={handleChange} />
        </TabPanel>

        <TabPanel value={activeTab} index={3}>
          <DisplayTab formValues={formValues} onChange={handleChange} />
        </TabPanel>

        <TabPanel value={activeTab} index={4}>
          <PurgeTab formValues={formValues} onChange={handleChange} />
        </TabPanel>

        <TabPanel value={activeTab} index={5}>
          <HotkeysTab formHotkeys={formHotkeys} onHotkeysChange={handleHotkeysChange} />
        </TabPanel>

        <TabPanel value={activeTab} index={6}>
          {tokenRemembered && (
            <Stack spacing={2} sx={{ pt: 1, pb: 3 }} data-testid="settings-saved-token">
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {t('settings.savedToken')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('settings.savedTokenHelp')}
              </Typography>
              <Box>
                <Button
                  variant="outlined"
                  onClick={() => dispatch(forgetRememberedToken())}
                  data-testid="settings-forget-token"
                >
                  {t('settings.forgetSavedToken')}
                </Button>
              </Box>
            </Stack>
          )}
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('settings.reset')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('settings.resetHelp')}
            </Typography>
            <Box>
              <ResetDiscrubButton variant="button" />
            </Box>
          </Stack>
        </TabPanel>
      </DialogContent>

      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, '& > :not(:first-of-type)': { ml: 0 } }}>
        {justSaved && (
          <Typography
            role="status"
            variant="body2"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 'auto', color: 'success.main' }}
          >
            <CheckCircleOutline fontSize="small" />
            {t('settings.saved')}
          </Typography>
        )}
        <Button variant="outlined" onClick={handleReset} disabled={saving}>
          {t('settings.resetToDefaults')}
        </Button>
        <Button variant="outlined" onClick={handleClose} disabled={saving}>
          {t('settings.cancel')}
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? t('settings.saving') : t('settings.save')}
        </Button>
      </DialogActions>

      <Dialog
        open={discardPromptOpen}
        onClose={() => setDiscardPromptOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('settings.discardTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('settings.discardBody')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiscardPromptOpen(false)} variant="outlined">
            {t('settings.keepEditing')}
          </Button>
          <Button onClick={performClose} variant="contained" color="error">
            {t('settings.discard')}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default SettingsModal;
