import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '@mui/material';
import { useAppDispatch } from '@/app/hooks';
import { signInAgain, type SignInAgainResult } from '@features/auth/authSlice';
import { addStatusEntry } from '@features/status/statusSlice';
import { isExtensionMode } from '@/extension/messaging';

interface SignInAgainRowProps {
  testId: string;
}

/**
 * Row 134: shown in a bulk dialog when the recorded run stopped because
 * the sign in expired. Picks up a fresh sign in from the open Discord tab
 * the way the Load All banner does (`signInAgain`), so Resume can go on.
 * Only the extension can read the tab, so the web app shows nothing.
 */
export default function SignInAgainRow({ testId }: SignInAgainRowProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [signingIn, setSigningIn] = useState(false);
  if (!isExtensionMode()) return null;

  const handleSignInAgain = async () => {
    setSigningIn(true);
    const result: SignInAgainResult = await dispatch(signInAgain()).unwrap().catch((): SignInAgainResult => 'failed');
    setSigningIn(false);
    const messages: Record<SignInAgainResult, string> = {
      signedIn: t('serverView.signedInAgain'),
      unchanged: t('serverView.signInUnchanged'),
      otherAccount: t('serverView.signInOtherAccount'),
      failed: t('serverView.signInFailed'),
    };
    dispatch(addStatusEntry({ level: result === 'signedIn' ? 'success' : 'warning', message: messages[result] }));
  };

  return (
    <Alert
      severity="warning"
      variant="outlined"
      data-testid={testId}
      sx={{ py: 0.5, alignItems: 'center' }}
      action={(
        <Button size="small" color="inherit" disabled={signingIn} onClick={() => void handleSignInAgain()} sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
          {t('serverView.signInAgain')}
        </Button>
      )}
    >
      {t('workspace.resumeSignInExpired')}
    </Alert>
  );
}
