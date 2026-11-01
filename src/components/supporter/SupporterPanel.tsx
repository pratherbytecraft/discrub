import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTER_PLAN, SupporterPanel as Panel, type SupporterPlan } from '@pratherbytecraft/supporter';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  applyPastedSupporterKey, refreshSupporterKey, removeSupporterKey,
  selectIsSupporter, selectSupporterClaimError, selectSupporterClaimInProgress, selectSupporterKeyStatus, selectSupporterLastCheckedAt, selectSupporterPayload,
} from '@features/supporter/supporterSlice';
import { HOSTED_URL, KOFI_BLEEDING_EDGE_YEARLY_URL, KOFI_MONTHLY_URL } from '@services/kofiLinks';
import SupporterFooterControls from './SupporterFooterControls';

/** Discrub sells two tiers: Supporter, and Bleeding Edge for the hosted build. */
const BLEEDING_EDGE_PLAN: SupporterPlan = {
  feature: 'hosted',
  nameKey: 'supporter.planBleedingEdge',
  blurbKey: 'supporter.hostedPlanBlurb',
  prices: {
    monthly: { price: '$5', unit: 'supporter.perMonth', url: KOFI_MONTHLY_URL },
    yearly: { price: '$40', unit: 'supporter.perYear', url: KOFI_BLEEDING_EDGE_YEARLY_URL },
  },
};
const PLANS = [SUPPORTER_PLAN, BLEEDING_EDGE_PLAN];

/**
 * The Supporter segment of the Appearance popover. The panel lives in the
 * supporter package; this reads Discrub's supporter slice, hands it props,
 * and puts the export footer controls under it.
 */
const SupporterPanel = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const keyStatus = useAppSelector(selectSupporterKeyStatus);
  const payload = useAppSelector(selectSupporterPayload);
  const claimInProgress = useAppSelector(selectSupporterClaimInProgress);
  const claimError = useAppSelector(selectSupporterClaimError);
  const lastCheckedAt = useAppSelector(selectSupporterLastCheckedAt);
  const isSupporter = useAppSelector(selectIsSupporter);
  const onApplyKey = useCallback((key: string) => { dispatch(applyPastedSupporterKey(key)); }, [dispatch]);
  const onRefresh = useCallback(() => { dispatch(refreshSupporterKey()); }, [dispatch]);
  const onRemove = useCallback(() => { dispatch(removeSupporterKey()); }, [dispatch]);
  return (
    <Panel
      keyStatus={keyStatus}
      payload={payload}
      claimInProgress={claimInProgress}
      claimErrorText={claimError ? t(claimError) : null}
      lastCheckedAt={lastCheckedAt}
      isSupporter={isSupporter}
      plans={PLANS}
      features={['themes', 'hosted']}
      onApplyKey={onApplyKey}
      onRefresh={onRefresh}
      onRemove={onRemove}
      oneKeyValues={{ host: HOSTED_URL.replace('https://', '') }}
    >
      <SupporterFooterControls />
    </Panel>
  );
};

export default SupporterPanel;
