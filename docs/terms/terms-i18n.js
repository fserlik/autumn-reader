(function () {
  const root = document.documentElement;
  const langButtons = document.querySelectorAll("[data-lang]");
  const versions = document.querySelectorAll("[data-language]");
  const skip = document.querySelector(".skip-link");
  const footerEs = document.querySelector("[data-footer-es]");
  const footerEn = document.querySelector("[data-footer-en]");
  const navLabels = {
    es: { home: "Inicio", docs: "Documentación", privacy: "Privacidad", terms: "Términos", downloads: "Descargas", contact: "Contacto" },
    en: { home: "Home", docs: "Documentation", privacy: "Privacy", terms: "Terms", downloads: "Downloads", contact: "Contact" },
  };

  function setLanguage(language) {
    const lang = language === "en" ? "en" : "es";
    const spanish = lang === "es";
    root.lang = lang;
    localStorage.setItem("autumn-site-language", lang);
    versions.forEach(version => { version.hidden = version.dataset.language !== lang; });
    langButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.lang === lang)));
    skip.textContent = spanish ? "Saltar al contenido" : "Skip to content";
    footerEs.hidden = !spanish;
    footerEn.hidden = spanish;
    document.querySelectorAll("[data-nav]").forEach(link => { link.textContent = navLabels[lang][link.dataset.nav]; });
    document.querySelector("[data-nav-logo]").setAttribute("aria-label", spanish ? "Autumn Reader, inicio" : "Autumn Reader, home");
    document.querySelector("[data-main-nav]").setAttribute("aria-label", spanish ? "Navegación principal" : "Main navigation");
    document.querySelector("[data-language-switcher]").setAttribute("aria-label", spanish ? "Idioma" : "Language");
    updateThemeLabel();
    document.title = spanish ? "Términos y condiciones · Autumn Reader" : "Terms and Conditions · Autumn Reader";
    document.querySelector('meta[name="description"]').content = spanish
      ? "Términos y condiciones de Autumn Reader: lectura, cuentas, planes, pagos, contenido y servicios en la nube."
      : "Terms and conditions for Autumn Reader: reading, accounts, plans, payments, content, and cloud services.";
  }

  function updateThemeLabel() {
    const dark = root.dataset.theme === "dark";
    document.querySelector(".theme-toggle").setAttribute("aria-label", root.lang === "es"
      ? (dark ? "Usar tema claro" : "Usar tema oscuro")
      : (dark ? "Use light theme" : "Use dark theme"));
  }

  langButtons.forEach(button => button.addEventListener("click", () => setLanguage(button.dataset.lang)));
  document.querySelector(".theme-toggle").addEventListener("click", updateThemeLabel);
  setLanguage(localStorage.getItem("autumn-site-language") || "es");
}());
