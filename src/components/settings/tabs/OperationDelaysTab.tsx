import { Box, Slider, Typography, Alert, Stack, Switch, useTheme } from '@mui/material';
import { REST_BREAK_AFTER_MS, REST_BREAK_LENGTH_MS } from '@/hooks/useRestBreaks';
import type { AppSettings } from 'discrub-core/types/discrub-types';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import TourFootnote from '@components/welcome/TourFootnote';
import { t } from '@/i18n';

interface OperationDelaysTabProps {
  formValues: AppSettings;
  onChange: (key: DiscrubSetting, value: string) => void;
}

/**
 * The Safest zone: an extra stretch of rail past `safestFrom` seconds, for
 * very long runs (day-long exports) where the user wants the slowest pace
 * available. It's compressed on the rail (`step` seconds per slider tick)
 * so the zones below keep their shape.
 */
interface SafestZoneConfig {
  /** Seconds where the Safest zone starts (the previous rail maximum). */
  from: number;
  /** Seconds at the end of the rail. */
  to: number;
  /** Seconds per slider tick inside the zone. */
  step: number;
}

export interface DelaySliderConfig {
  key: DiscrubSetting;
  labelKey: string;
  descriptionKey: string;
  min: number;
  max: number;
  step: number;
  recommendedMin: number;
  recommendedMax: number;
  safest?: SafestZoneConfig;
}

/** Slider position (in ticks of `config.step`) for a value in seconds. */
export const secondsToSlider = (seconds: number, config: DelaySliderConfig): number => {
  const { safest } = config;
  if (!safest || seconds <= safest.from) return seconds;
  const clamped = Math.min(seconds, safest.to);
  return safest.from + ((clamped - safest.from) / safest.step) * config.step;
};

/** Seconds for a slider position; the inverse of `secondsToSlider`. */
export const sliderToSeconds = (position: number, config: DelaySliderConfig): number => {
  const { safest } = config;
  if (!safest || position <= safest.from) return position;
  const seconds = safest.from + ((position - safest.from) / config.step) * safest.step;
  return parseFloat(Math.min(seconds, safest.to).toFixed(1));
};

/** The rail's last position: `max` seconds, or the end of the Safest zone. */
const sliderMax = (config: DelaySliderConfig): number =>
  config.safest ? secondsToSlider(config.safest.to, config) : config.max;

/** 10s–30s in half-second ticks, on top of a 0–10s rail. */
const SAFEST_ZONE: SafestZoneConfig = { from: 10, to: 30, step: 0.5 };
export const SAFEST_COLOR = '#26a69a';

const SEARCH_CONFIG: DelaySliderConfig = {
  key: DiscrubSetting.SEARCH_DELAY,
  labelKey: 'delays.searchDelay',
  descriptionKey: 'delays.searchDelayHelp',
  min: 0, max: 10, step: 0.1,
  recommendedMin: 1, recommendedMax: 3,
  safest: SAFEST_ZONE,
};

const DELETE_CONFIG: DelaySliderConfig = {
  key: DiscrubSetting.DELETE_DELAY,
  labelKey: 'delays.deleteDelay',
  descriptionKey: 'delays.deleteDelayHelp',
  min: 0, max: 10, step: 0.1,
  recommendedMin: 2, recommendedMax: 4,
  safest: SAFEST_ZONE,
};

const MODIFIER_CONFIG: DelaySliderConfig = {
  key: DiscrubSetting.DELAY_MODIFIER,
  labelKey: 'delays.modifier',
  descriptionKey: 'delays.modifierHelp',
  min: 0, max: 5, step: 0.1,
  recommendedMin: 0.5, recommendedMax: 2,
};

/**
 * Zone colors and labels:
 * - Red (0s): Risky — no delay, high chance of rate limiting
 * - Amber (below recommended): Low — faster but less safe
 * - Green (recommended range): Recommended — balanced speed and safety
 * - Blue (above recommended): Safe — very safe but slower operations
 * - Teal (past the old maximum): Safest — the slowest pace, for day-long runs
 */
export const getZoneColor = (value: number, config: DelaySliderConfig, safeColor: string): string => {
  if (value === 0) return '#f44336';
  if (value < config.recommendedMin) return '#ff9800';
  if (value <= config.recommendedMax) return '#4caf50';
  if (config.safest && value > config.safest.from) return SAFEST_COLOR;
  return safeColor; // theme accent — safe but slow
};

export const getZoneLabel = (value: number, config: DelaySliderConfig): string => {
  if (value === 0) return t('delays.zoneRisky');
  if (value < config.recommendedMin) return t('delays.zoneLow');
  if (value <= config.recommendedMax) return t('delays.zoneRecommended');
  if (config.safest && value > config.safest.from) return t('delays.zoneSafest');
  return t('delays.zoneSafe');
};

/**
 * Build a CSS linear-gradient for the slider rail with blended transitions.
 * Red → amber → green → blue (→ teal for the Safest zone), with smooth color
 * transitions between zones. Positions are in slider ticks, so the Safest
 * zone's compression is honoured.
 */
export const buildRailGradient = (config: DelaySliderConfig, safeColor: string): string => {
  const { min, max, recommendedMin, recommendedMax, safest } = config;
  const range = sliderMax(config) - min;
  const toPct = (v: number) => ((secondsToSlider(v, config) - min) / range) * 100;

  // Blend midpoints between zones for smooth transitions
  const redMid = toPct(recommendedMin * 0.25);
  const amberToGreen = toPct(recommendedMin);
  // greenCore reserved for future gradient refinement
  void toPct((recommendedMin + recommendedMax) / 2);
  const greenToBlue = toPct(recommendedMax);
  const blueMid = toPct(recommendedMax + (max - recommendedMax) * 0.5);
  const tail = safest
    ? `${safeColor} ${toPct(safest.from)}%, ${SAFEST_COLOR} ${toPct(safest.from + (safest.to - safest.from) * 0.5)}%, ${SAFEST_COLOR} 100%`
    : `${safeColor} 100%`;

  return `linear-gradient(to right, `
    + `#f44336 0%, `
    + `#ff9800 ${redMid}%, `
    + `#4caf50 ${amberToGreen}%, `
    + `#4caf50 ${greenToBlue}%, `
    + `${safeColor} ${blueMid}%, `
    + tail + `)`;
};

const DelaySlider = ({
  config,
  value,
  onChange,
}: {
  config: DelaySliderConfig;
  value: number;
  onChange: (key: DiscrubSetting, value: string) => void;
}) => {
  const theme = useTheme();
  const safeColor = theme.palette.cta.main;
  const thumbColor = getZoneColor(value, config, safeColor);
  const zoneLabel = getZoneLabel(value, config);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {t(config.labelKey)}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography
            variant="caption"
            sx={{ color: thumbColor, fontWeight: 600, fontSize: '0.7rem' }}
          >
            {zoneLabel}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, minWidth: '36px', textAlign: 'right' }}>
            {parseFloat(value.toFixed(1))}s
          </Typography>
        </Box>
      </Box>
      <Slider
        value={secondsToSlider(value, config)}
        onChange={(_, newValue) => onChange(config.key, sliderToSeconds(newValue as number, config).toFixed(1))}
        min={config.min}
        max={sliderMax(config)}
        step={config.step}
        scale={(position) => sliderToSeconds(position, config)}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${parseFloat(v.toFixed(1))}s`}
        marks={[
          { value: config.min, label: `${config.min}s` },
          ...(config.safest
            ? [
                { value: config.safest.from, label: `${config.safest.from}s` },
                { value: sliderMax(config), label: `${config.safest.to}s` },
              ]
            : [{ value: config.max, label: `${config.max}s` }]),
        ]}
        sx={{
          '& .MuiSlider-track': { display: 'none' },
          '& .MuiSlider-thumb': {
            backgroundColor: thumbColor,
            border: '2px solid',
            borderColor: thumbColor,
            zIndex: 1,
          },
          '& .MuiSlider-rail': {
            opacity: 1,
            background: buildRailGradient(config, safeColor),
            height: 6,
          },
        }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5, display: 'block' }}>
        {t(config.descriptionKey)}
      </Typography>
    </Box>
  );
};

/**
 * The modifier only ever adds: every loop paces with `calculateRandomDelay`,
 * which sleeps base + random(0..modifier). So the effective range is
 * [base, base + modifier], never below the base.
 */
export const OperationDelaysTab = ({ formValues, onChange }: OperationDelaysTabProps) => {
  const searchDelay = parseFloat(formValues[DiscrubSetting.SEARCH_DELAY]) || 0;
  const deleteDelay = parseFloat(formValues[DiscrubSetting.DELETE_DELAY]) || 0;
  const modifier = parseFloat(formValues[DiscrubSetting.DELAY_MODIFIER]) || 0;
  const restBreaks = formValues[DiscrubSetting.REST_BREAKS] !== 'false';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Alert severity="info" sx={{ '& .MuiAlert-message': { display: 'flex', alignItems: 'center' } }}>
        <Box component="span">
          {t('delays.intro')}
        </Box>
        <TourFootnote stepKey="operation-delays" />
      </Alert>

      <DelaySlider config={SEARCH_CONFIG} value={searchDelay} onChange={onChange} />
      <Typography variant="caption" color="text.secondary" sx={{ mt: -2 }}>
        Effective delay: {parseFloat(searchDelay.toFixed(1))}s to {parseFloat((searchDelay + modifier).toFixed(1))}s
      </Typography>

      <DelaySlider config={DELETE_CONFIG} value={deleteDelay} onChange={onChange} />
      <Typography variant="caption" color="text.secondary" sx={{ mt: -2 }}>
        Effective delay: {parseFloat(deleteDelay.toFixed(1))}s to {parseFloat((deleteDelay + modifier).toFixed(1))}s
      </Typography>

      <DelaySlider config={MODIFIER_CONFIG} value={modifier} onChange={onChange} />

      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="subtitle2">{t('delays.restBreaks')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('delays.restBreaksHelp', {
              active: Math.round(REST_BREAK_AFTER_MS / 60000),
              minutes: Math.round(REST_BREAK_LENGTH_MS / 60000),
            })}
          </Typography>
        </Box>
        <Switch
          checked={restBreaks}
          onChange={(e) => onChange(DiscrubSetting.REST_BREAKS, e.target.checked ? 'true' : 'false')}
          inputProps={{ 'aria-label': t('delays.restBreaks') }}
        />
      </Stack>
    </Box>
  );
};
