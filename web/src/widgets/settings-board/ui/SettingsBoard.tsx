import { useTranslation } from "react-i18next";
import { InlineSelect } from "../../../shared/ui";
import { type InlineSelectOption } from "../../../shared/ui/InlineSelect";
import { supportedLocales } from "../../../shared/i18n";
import { controlInputClassName } from "../../../shared/ui/surfaceClassNames";

const fieldLabelClassName = "mb-1.5 block text-xs text-[var(--muted)]";

export function SettingsBoard() {
  const { t, i18n } = useTranslation("settings");

  const languageOptions: InlineSelectOption[] = supportedLocales.map((locale) => ({
    value: locale,
    label: t(`language.${locale}`),
  }));

  const handleChangeLanguage = (locale: string) => {
    void i18n.changeLanguage(locale);
    localStorage.setItem("taskmeld-locale", locale);
  };

  return (
    <section data-center-card className="min-h-0 min-w-0 p-3">
      <div className="max-w-[400px]">
        <label className={fieldLabelClassName}>{t("language.label")}</label>
        <InlineSelect
          value={i18n.language}
          options={languageOptions}
          onChange={handleChangeLanguage}
          triggerClassName={controlInputClassName}
          ariaLabel={t("language.label")}
        />
      </div>
    </section>
  );
}
