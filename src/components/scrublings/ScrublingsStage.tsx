import { useCallback } from 'react';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { ScrublingsStage as Stage, DISCORD_FLAVOR, type ScrublingId } from '@pratherbytecraft/scrublings';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSetting, updateSetting } from '@features/app/appSlice';
import { selectScrublingsEnabled, selectScrublingsOperationView, selectScrublingsPositions, selectScrublingsVisible, selectScrublingLineContext } from '@features/scrublings/selectors';
import { perfCount } from '@/utils/perfCounters';

/**
 * The Scrublings' stage on a bar. The characters, the scheduler and the
 * drawing live in the Scrublings package; this reads Discrub's store and
 * settings and hands them over as props. See the package README.
 */
const ScrublingsStage = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const enabled = useAppSelector(selectScrublingsEnabled);
  const visible = useAppSelector(selectScrublingsVisible);
  const positions = useAppSelector(selectScrublingsPositions);
  const op = useAppSelector(selectScrublingsOperationView);
  const lineContext = useAppSelector(selectScrublingLineContext);
  const animations = useAppSelector(selectSetting(DiscrubSetting.APP_THEME_ANIMATIONS));
  const onPositionChange = useCallback((id: ScrublingId, fraction: number) => {
    dispatch(updateSetting({ key: DiscrubSetting.APP_SCRUBLINGS_POSITIONS, value: JSON.stringify({ ...positions, [id]: fraction }) }));
  }, [dispatch, positions]);
  const nameOf = useCallback((id: ScrublingId) => t(`scrublings.names.${id}`), [t]);
  return (
    <Stage
      enabled={enabled}
      visible={visible}
      positions={positions}
      onPositionChange={onPositionChange}
      animations={animations !== 'false'}
      op={op}
      lineContext={lineContext}
      flavor={DISCORD_FLAVOR}
      nameOf={nameOf}
      onRender={() => perfCount('ScrublingsStage')}
    />
  );
};

export default ScrublingsStage;
