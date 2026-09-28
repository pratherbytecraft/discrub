import { Box, Checkbox, Link, Switch, Typography, alpha, useTheme } from '@mui/material';
import { LockOutlined as LockIcon, OpenInNew as OpenIcon } from '@mui/icons-material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { updateSetting } from '@features/app/appSlice';
import { selectHasThemes } from '@features/supporter/supporterSlice';
import { MAX_PICKED, SCRUBLINGS, SCRUBLING_IDS, type ScrublingDescriptor, type ScrublingId } from '@features/scrublings/descriptors';
import { selectScrublingsEnabled, selectScrublingsPicked } from '@features/scrublings/selectors';
import { frameDataUri } from '@features/scrublings/spriteRender';
import { KOFI_COMMISSIONS_URL } from '@/services/kofiLinks';
import { useStageSlots } from '@features/scrublings/stageSlots';
import { SPRITE_H, SPRITE_W } from '@features/scrublings/spriteTypes';
import { groupItems, inSeason, isUnlocked, type ItemGroup } from '@features/appearance/groups';
import { formatSeasonEnd } from '@features/appearance/seasonText';

interface ScrublingsTabProps {
  onLockedPick: () => void;
}

/**
 * The Scrublings segment of the Appearance menu (2.2.0): a master switch, the
 * count, and the cards in four columns. Suds, the Mage and the Cat are free; the
 * rest lock without supporter access and open the hub, like a locked theme.
 * Up to three can be picked at once. The menu names them and says what they
 * are; what they do on the bar stays for people to find.
 *
 * 2.2.3: the cards sit in groups with a heading each, Standard, Holiday and
 * Commissioned, like the theme grid. Holiday leads while one of its
 * Scrublings is in season, when it is unlocked for everyone. Commissioned
 * shows a line while it is empty.
 */
const ScrublingsTab = ({ onLockedPick }: ScrublingsTabProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const enabled = useAppSelector(selectScrublingsEnabled);
  const picked = useAppSelector(selectScrublingsPicked);
  const isSupporter = useAppSelector(selectHasThemes);
  const slots = useStageSlots();
  const full = picked.length >= MAX_PICKED;
  const shown = slots == null ? null : Math.min(slots, picked.length);

  const setPicked = (ids: ScrublingId[]) =>
    dispatch(updateSetting({ key: DiscrubSetting.APP_SCRUBLINGS_PICKED, value: JSON.stringify(ids) }));
  const toggle = (id: ScrublingId) => {
    const locked = !isUnlocked(SCRUBLINGS[id], isSupporter);
    if (locked) { onLockedPick(); return; }
    if (picked.includes(id)) setPicked(picked.filter((p) => p !== id));
    else if (!full) setPicked([...picked, id]);
  };

  const heading = (group: ItemGroup, items: ScrublingDescriptor[]) => {
    const open = items.find((d) => inSeason(d.season));
    return (
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
        <Typography variant="overline" sx={{ lineHeight: 1.6, letterSpacing: '0.08em', color: 'text.secondary' }} data-testid={`scrublings-group-${group}`}>{t(`appearance.groups.${group}`)}</Typography>
        {open?.season && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }} data-testid="scrublings-group-holiday-open">
            {t('appearance.holidayOpen', { name: t(`scrublings.names.${open.id}`), date: formatSeasonEnd(open.season) })}
          </Typography>
        )}
      </Box>
    );
  };

  const card = (d: ScrublingDescriptor) => {
    const id = d.id;
    const name = t(`scrublings.names.${id}`);
    const isPicked = picked.includes(id);
    const locked = !isUnlocked(d, isSupporter);
    const blocked = !isPicked && full && !locked;
    const label = locked ? t('scrublings.lockedOne', { name }) : name;
    return (
      <Box
        key={id}
        role="checkbox"
        tabIndex={0}
        aria-checked={isPicked}
        aria-label={label}
        aria-disabled={blocked || undefined}
        data-testid={`scrubling-card-${id}`}
        onClick={() => toggle(id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(id); } }}
        sx={{
          position: 'relative', textAlign: 'left', cursor: blocked ? 'default' : 'pointer',
          p: '10px 10px 8px', borderRadius: 2, border: '1px solid',
          borderColor: isPicked ? 'primary.main' : 'divider',
          backgroundColor: isPicked ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
          opacity: blocked ? 0.55 : 1,
          boxShadow: locked ? `0 0 0 1px ${alpha(theme.palette.error.main, 0.35)}, 0 0 10px ${alpha(theme.palette.error.main, 0.25)}` : 'none',
          '&:hover': blocked ? {} : { backgroundColor: isPicked ? alpha(theme.palette.primary.main, 0.14) : alpha(theme.palette.text.primary, 0.05) },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
        }}
      >
        <Box sx={{ display: 'grid', placeItems: 'center', height: 64, mb: 0.75, opacity: locked ? 0.75 : 1 }}>
          <Box
            aria-hidden
            sx={{ width: SPRITE_W * 2, height: SPRITE_H * 2, backgroundImage: `url("${frameDataUri(d.sheet, d.sheet.activities[d.idle]?.[0] ?? 'idle1')}")`, backgroundSize: '100% 100%', imageRendering: 'pixelated' }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Checkbox size="small" checked={isPicked} tabIndex={-1} disableRipple sx={{ p: 0, pointerEvents: 'none' }} inputProps={{ 'aria-hidden': true }} />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>
          {d.tier === 'free' && (
            <Box component="span" sx={{ ml: 'auto', fontSize: '0.65rem', color: 'text.secondary', border: '1px solid', borderColor: 'divider', borderRadius: 0.5, px: 0.5 }}>{t('scrublings.free')}</Box>
          )}
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.35, minHeight: 31, mt: 0.5 }}>{t(`scrublings.blurbs.${id}`)}</Typography>
        {d.designedBy && (
          <Typography variant="caption" data-testid={`scrubling-designer-${id}`} sx={{ color: 'text.secondary', display: 'block', fontStyle: 'italic', mt: 0.25 }}>{t('scrublings.designedBy', { name: d.designedBy })}</Typography>
        )}
        {locked && (
          <Box data-testid={`scrubling-locked-${id}`} sx={{ position: 'absolute', right: 6, top: 6, width: 18, height: 18, borderRadius: '50%', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', display: 'grid', placeItems: 'center' }}>
            <LockIcon sx={{ fontSize: 11, color: 'error.main' }} />
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ p: 1.75, pb: 1.25, maxHeight: 'min(520px, calc(100vh - 170px))', overflowY: 'auto' }} data-testid="scrublings-tab">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
        <Box component="label" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}>
          <Switch
            size="small"
            checked={enabled}
            onChange={(_, on) => dispatch(updateSetting({ key: DiscrubSetting.APP_SCRUBLINGS_ENABLED, value: on ? 'true' : 'false' }))}
            inputProps={{ 'aria-label': t('scrublings.show') }}
            data-testid="scrublings-switch"
          />
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{t('scrublings.show')}</Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }} data-testid="scrublings-count">
          {t('scrublings.picked', { count: picked.length, max: MAX_PICKED })}
          {enabled && shown != null && shown < picked.length ? ` · ${t('scrublings.fits', { count: shown })}` : ''}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }} data-testid="scrublings-cards">
        {groupItems(SCRUBLING_IDS.map((id) => SCRUBLINGS[id])).map(({ group, items }) => (
          <Box key={group} data-testid={`scrublings-group-section-${group}`}>
            {heading(group, items)}
            {items.length === 0 ? (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }} data-testid={`scrublings-group-empty-${group}`}>{t('appearance.groupEmpty')}</Typography>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>{items.map(card)}</Box>
            )}
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 1.25, pt: 1.1, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('scrublings.customFree')}</Typography>
        <Link href={KOFI_COMMISSIONS_URL} target="_blank" rel="noopener noreferrer" underline="hover" data-testid="scrublings-request" sx={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          {t('scrublings.request')} <OpenIcon sx={{ fontSize: 13 }} />
        </Link>
      </Box>
    </Box>
  );
};

export default ScrublingsTab;
