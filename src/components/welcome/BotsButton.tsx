import { useState } from 'react';
import { Box, Button, IconButton, Link, Popover, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { SmartToy as BotsIcon, GitHub as GitHubIcon, OpenInNew as OpenIcon } from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { BOTS, BOT_IDEA_MAILTO, installUrlFor } from './bots';
import { DEVELOPER } from './developer';
import RetrostatMark from './RetrostatMark';
import ScourMark from './ScourMark';
import VestedMark from './VestedMark';

const MARKS: Record<string, (size: number) => React.ReactNode> = {
  retrostat: (size) => <RetrostatMark size={size} />,
  scour: (size) => <ScourMark size={size} />,
  vested: (size) => <VestedMark size={size} />,
};

/** The list itself, so a menu entry can open it too (Classic's More menu on a phone). */
export const BotsPopover = ({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { 'data-testid': 'bots-popover', 'aria-label': t('bots.title'), sx: { mt: 1, width: 380, maxWidth: 'calc(100vw - 24px)', borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' } } as object }}
    >
      <Typography sx={{ px: 1.75, py: 1.5, fontWeight: 700, fontSize: '0.9rem' }}>{t('bots.title')}</Typography>
      {BOTS.map((bot) => (
        <Box key={bot.id} data-testid={`bots-row-${bot.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ flexShrink: 0, display: 'grid', placeItems: 'center' }}>{MARKS[bot.id]?.(40)}</Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3 }}>{bot.name}</Typography>
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.35 }}>{bot.tagline}</Typography>
            <Link href={bot.pageUrl} target="_blank" rel="noopener noreferrer" underline="hover" data-testid={`bots-learn-${bot.id}`} sx={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
              {t('bots.learnMore')} <OpenIcon sx={{ fontSize: 12 }} />
            </Link>
          </Box>
          <Button component="a" href={installUrlFor(bot.id, 'discrub-bots-menu')} target="_blank" rel="noopener noreferrer" variant="contained" size="small" data-testid={`bots-add-${bot.id}`} sx={{ textTransform: 'none', fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {t('bots.addToDiscord')}
          </Button>
        </Box>
      ))}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.75, py: 1.25, borderTop: '1px solid', borderColor: 'divider', backgroundColor: alpha(theme.palette.common.black, 0.18), flexWrap: 'wrap' }}>
        <Box component="img" src={DEVELOPER.avatar} alt="" width={28} height={28} sx={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.3 }}>{DEVELOPER.name}</Typography>
          <Link href={DEVELOPER.profileUrl} target="_blank" rel="noopener noreferrer" underline="hover" data-testid="bots-follow" sx={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <GitHubIcon sx={{ fontSize: 13 }} /> {t('bots.follow', { handle: DEVELOPER.handle })}
          </Link>
        </Box>
        <Link href={BOT_IDEA_MAILTO} underline="hover" data-testid="bots-idea" sx={{ fontSize: '0.75rem', fontWeight: 600 }}>{t('bots.idea')}</Link>
      </Box>
    </Popover>
  );
};

interface BotsButtonProps {
  /** Show the word next to the icon. Bars with small icon buttons pass false. */
  label?: boolean;
  size?: 'small' | 'medium';
  /** Leave the bar on a phone, where the one free slot belongs to a Scrubling. */
  hideOnPhone?: boolean;
}

/**
 * The developer's Discord bots, one click from every layout's top bar
 * (2.2.0, owner 2026-09-21). Replaces the welcome screen corkboard: a plain
 * list with Add to Discord and Learn more per bot, and a footer with the
 * developer's GitHub follow link and the bot idea address.
 */
const BotsButton = ({ label = true, size = 'small', hideOnPhone = false }: BotsButtonProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);
  const trigger = label ? (
    <Button
      size="small"
      color="inherit"
      onClick={(e) => setAnchor(e.currentTarget)}
      startIcon={<BotsIcon />}
      aria-label={t('bots.button')}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="bots-button"
      sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 4, px: 1.5, height: 32, flexShrink: 0, border: '1px solid', borderColor: alpha(theme.palette.primary.main, 0.45), backgroundColor: alpha(theme.palette.primary.main, 0.16), '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.26) } }}
    >
      <span className="bots-label">{t('bots.button')}</span>
    </Button>
  ) : (
    <Tooltip title={t('bots.button')} enterDelay={0} arrow>
      <IconButton size={size} color="inherit" onClick={(e) => setAnchor(e.currentTarget)} aria-label={t('bots.button')} aria-haspopup="dialog" aria-expanded={open} data-testid="bots-button">
        <BotsIcon />
      </IconButton>
    </Tooltip>
  );
  if (hideOnPhone && phone) return null;
  return (
    <>
      {trigger}
      <BotsPopover anchor={anchor} onClose={() => setAnchor(null)} />
    </>
  );
};

export default BotsButton;
