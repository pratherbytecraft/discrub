import { useRef, useState } from 'react';
import { Box, Typography, Card, CardContent, CardActionArea, Button, Chip, Link } from '@mui/material';
import OnboardingGuideModal from '@components/modals/OnboardingGuideModal';
import {
  Storage as ServerIcon,
  Search as SearchIcon,
  FileDownload as ExportIcon,
  DeleteSweep as PurgeIcon,
  Forum as ForumIcon,
  BarChart as AnalyticsIcon,
  Settings as SettingsIcon,
  Palette as ThemeIcon,
  Terminal as StatusIcon,
  PauseCircle as PauseIcon,
  Favorite as DonationIcon,
  Explore as TourIcon,
  ArrowForward as ArrowIcon,
  GitHub as GitHubIcon,
  Star as StarIcon,
  FolderZip as PackageIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

const GITHUB_REPO_URL = 'https://github.com/prathercc/discrub';

interface WelcomePanelProps {
  onStartTour: () => void;
}

interface FeatureCard {
  icon: React.ReactNode;
  id: string;
}

const GETTING_STARTED_STEPS = [
  { icon: <ServerIcon />, textKey: 'welcome.step1' },
  { icon: <SearchIcon />, textKey: 'welcome.step2' },
  { icon: <ExportIcon />, textKey: 'welcome.step3' },
  { icon: <PurgeIcon />, textKey: 'welcome.step4' },
];

const FEATURE_CARDS: FeatureCard[] = [
  {
    id: 'export',
    icon: <ExportIcon />,
  },
  {
    id: 'purge',
    icon: <PurgeIcon />,
  },
  {
    id: 'search',
    icon: <SearchIcon />,
  },
  {
    id: 'forum',
    icon: <ForumIcon />,
  },
  {
    id: 'package',
    icon: <PackageIcon />,
  },
  {
    id: 'analytics',
    icon: <AnalyticsIcon />,
  },
  {
    id: 'settings',
    icon: <SettingsIcon />,
  },
  {
    id: 'theme',
    icon: <ThemeIcon />,
  },
  {
    id: 'status',
    icon: <StatusIcon />,
  },
  {
    id: 'pause',
    icon: <PauseIcon />,
  },
  {
    id: 'donations',
    icon: <DonationIcon />,
  },
];

const WelcomePanel = ({ onStartTour }: WelcomePanelProps) => {
  const { t } = useTranslation();
  const featureCardsRef = useRef<HTMLDivElement>(null);
  const v1Ref = useRef<HTMLDivElement>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
  <>
    <Box
      sx={{
        height: '100%',
        overflow: 'auto',
        scrollBehavior: 'smooth',
        px: { xs: 2, sm: 4, md: 6 },
        py: 4,
      }}
    >
      {/* Header */}
      <Box sx={{ textAlign: 'center', mb: 5 }}>
        <Typography
          variant="h4"
          sx={{
            fontWeight: 700,
            background: (theme) =>
              theme.palette.mode === 'dark'
                ? `linear-gradient(90deg, ${theme.palette.text.primary}, ${theme.palette.text.secondary})`
                : `linear-gradient(90deg, ${theme.palette.text.primary}, ${theme.palette.cta.main})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            mb: 1,
          }}
        >
          {t('welcome.title')}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 520, mx: 'auto' }}>
          {t('welcome.subtitle')}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<TourIcon />}
            onClick={onStartTour}
            data-tour="start-tour"
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {t('welcome.takeTour')}
          </Button>
          <Button
            variant="outlined"
            onClick={() => scrollTo(featureCardsRef)}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {t('welcome.exploreFeatures')}
          </Button>
          <Button
            variant="outlined"
            onClick={() => scrollTo(v1Ref)}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {t('welcome.comingFromClassic')}
          </Button>
        </Box>

        <Box
          data-testid="welcome-github-actions"
          sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap', mt: 1.5 }}
        >
          <Button
            variant="outlined"
            size="small"
            startIcon={<StarIcon />}
            endIcon={<GitHubIcon sx={{ fontSize: 16 }} />}
            component="a"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ textTransform: 'none' }}
          >
            {t('welcome.starOnGithub')}
          </Button>
        </Box>
      </Box>

      {/* Corkboard: bots from the same workshop */}

      {/* Getting Started */}
      <Box sx={{ mb: 5, maxWidth: 640, mx: 'auto' }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          {t('welcome.gettingStarted')}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {GETTING_STARTED_STEPS.map((step, i) => (
            <Box
              key={i}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 1.5,
                borderRadius: 2,
                backgroundColor: 'action.hover',
                border: 1,
                borderColor: 'divider',
              }}
            >
              <Chip
                label={i + 1}
                size="small"
                color="primary"
                sx={{ fontWeight: 700, minWidth: 32 }}
              />
              <Box sx={{ color: 'primary.main', display: 'flex', alignItems: 'center' }}>
                {step.icon}
              </Box>
              <Typography variant="body2" color="text.primary">
                {t(step.textKey)}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Feature Cards */}
      <Box ref={featureCardsRef} sx={{ mb: 5, maxWidth: 900, mx: 'auto', scrollMarginTop: 16 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          {t('welcome.features')}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 2,
          }}
        >
          {FEATURE_CARDS.map((card) => (
            <Card
              key={card.id}
              variant="outlined"
              sx={{
                transition: 'all 200ms ease',
                '&:hover': {
                  borderColor: 'primary.main',
                  transform: 'translateY(-2px)',
                  boxShadow: (theme) => theme.customShadows?.elevation2 ?? '0 4px 12px rgba(0, 0, 0, 0.15)',
                },
              }}
            >
              <CardActionArea sx={{ height: '100%', cursor: 'default' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Box sx={{ color: 'primary.main' }}>{card.icon}</Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {t(`welcome.feature.${card.id}.title`)}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                    {t(`welcome.feature.${card.id}.description`)}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      </Box>

      {/* Coming from v1 */}
      <Box
        ref={v1Ref}
        sx={{
          mb: 4,
          maxWidth: 640,
          mx: 'auto',
          scrollMarginTop: 16,
          p: 3,
          borderRadius: 2,
          border: 1,
          borderColor: 'divider',
          backgroundColor: 'action.hover',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <ArrowIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('welcome.classicTitle')}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.6 }}>
          {t('welcome.classicBody')}
        </Typography>
        <Link
          component="button"
          onClick={() => setGuideOpen(true)}
          sx={{ fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
        >
          {t('welcome.migrationGuide')}
        </Link>
      </Box>
    </Box>

    <OnboardingGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
  </>
  );
};

export default WelcomePanel;
