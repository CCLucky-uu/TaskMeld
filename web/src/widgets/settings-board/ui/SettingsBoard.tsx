import { useTranslation } from "react-i18next";
import { InlineSelect } from "../../../shared/ui";
import { type InlineSelectOption } from "../../../shared/ui/InlineSelect";
import { supportedLocales } from "../../../shared/i18n";
import { controlInputClassName } from "../../../shared/ui/surfaceClassNames";

const fieldLabelClassName = "mb-1.5 block text-xs text-[var(--muted)]";

export function SettingsBoard() {
  const { t, i18n } = useTranslation("common");

  const languageOptions: InlineSelectOption[] = supportedLocales.map((locale) => ({
    value: locale,
    label: t(`settings.language.${locale}`),
  }));

  const handleChangeLanguage = (locale: string) => {
    void i18n.changeLanguage(locale);
    localStorage.setItem("taskmeld-locale", locale);
  };

  return (
    <section data-center-card className="min-h-0 min-w-0 p-3">
      <h2 className="mb-3 text-lg font-semibold text-[var(--text)]">{t("settings.title")}</h2>
      <div className="max-w-[400px]">
        <label className={fieldLabelClassName}>{t("settings.language.label")}</label>
        <InlineSelect
          value={i18n.language}
          options={languageOptions}
          onChange={handleChangeLanguage}
          triggerClassName={controlInputClassName}
          ariaLabel={t("settings.language.label")}
        />
      </div>
    </section>
  );
}
