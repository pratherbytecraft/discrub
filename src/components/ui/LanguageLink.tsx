import { Link } from '@mui/material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/app/hooks';
import { updateSetting } from '@features/app/appSlice';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, normalizeLanguage, LANGUAGE_TAGS } from '@/i18n/language';

/**
 * Login-screen language switch (#124): one text link per language
 * other than the active one, so a German visitor sees "Deutsch" without
 * signing in first. Persists immediately; the landing page has no Save.
 */
const LanguageLink = () => {
  const dispatch = useAppDispatch();
  const { i18n } = useTranslation();
  const active = normalizeLanguage(i18n.language);
  return (
    <>
      {SUPPORTED_LANGUAGES.filter((code) => code !== active).map((code) => (
        <Link
          key={code}
          component="button"
          type="button"
          variant="caption"
          color="primary"
          lang={LANGUAGE_TAGS[code]}
          data-testid={`landing-language-${code}`}
          onClick={() => dispatch(updateSetting({ key: DiscrubSetting.APP_LANGUAGE, value: code }))}
        >
          {LANGUAGE_LABELS[code]}
        </Link>
      ))}
    </>
  );
};

export default LanguageLink;
