import { Box, Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { BOTS } from './bots';
import RetrostatMark from './RetrostatMark';

/**
 * One-line contextual nudge for the Analytics modal: the user is doing by
 * hand exactly what Retrostat automates, so this is the highest-intent spot
 * for a mention. One sentence and a link, always present under the results,
 * never modal. Deliberately not dismissible (owner call, 2026-08-26): it is
 * a footer line inside a modal the user opened on purpose, and the moment it
 * lands may be the fifth Analytics session, not the first.
 */
const BotNudge = () => {
  const { t } = useTranslation();
  const bot = BOTS.find((entry) => entry.id === 'retrostat');
  if (!bot) return null;

  return (
    <Box
      data-testid="bot-nudge"
      sx={{
        mt: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 0.75,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        backgroundColor: 'action.hover',
      }}
    >
      <RetrostatMark size={22} />
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1, lineHeight: 1.4 }}>
        {t('bots.analyticsNudge', { name: bot.name })}{' '}
        <Link href={bot.pageUrl} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ fontWeight: 600 }}>
          {t('bots.learnMore')}
        </Link>
      </Typography>
    </Box>
  );
};

export default BotNudge;
