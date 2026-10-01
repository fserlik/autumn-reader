const releasesUrl = "https://api.github.com/repos/fserlik/autumn-reader/releases?per_page=20";

const installers = {
  windows: [/\.exe$/i, /\.msi$/i],
  macos: [/\.dmg$/i, /\.pkg$/i],
  linux: [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i],
};

function updatePlatform(platform, assets, version) {
  const card = document.querySelector(`[data-platform="${platform}"]`);
  if (!card || assets.length === 0) return;

  const link = card.querySelector("[data-download]");
  const status = card.querySelector("[data-status]");
  const versionLabel = card.querySelector("[data-version]");
  const pending = card.querySelector("[data-pending]");
  const [primary, ...alternatives] = assets;
  const extension = primary.name.match(/\.(AppImage|exe|msi|dmg|pkg|deb|rpm)$/i)?.[0] ?? "";

  link.href = primary.browser_download_url;
  link.textContent = `${window.autumnI18n?.lang === "es" ? "Descargar instalador" : "Download installer"} ${extension}`;
  link.hidden = false;
  status.textContent = window.autumnI18n?.lang === "es" ? "Disponible" : "Available";
  status.classList.remove("availability-pending");
  versionLabel.textContent = `${window.autumnI18n?.lang === "es" ? "Versión" : "Version"} ${version}`;
  versionLabel.hidden = false;
  if (pending) pending.hidden = true;
  card.classList.add("download-card-available");

  if (alternatives.length > 0) {
    const list = document.createElement("ul");
    list.className = "alternative-downloads";
    for (const asset of alternatives) {
      const item = document.createElement("li");
      const alternative = document.createElement("a");
      alternative.href = asset.browser_download_url;
      alternative.textContent = asset.name;
      item.append(alternative);
      list.append(item);
    }
    card.append(list);
  }
}

async function loadLatestInstallers() {
  try {
    const response = await fetch(releasesUrl, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;

    const releases = await response.json();
    if (!Array.isArray(releases)) return;

    for (const [platform, patterns] of Object.entries(installers)) {
      const release = releases.find((candidate) =>
        !candidate.draft && !candidate.prerelease &&
        Array.isArray(candidate.assets) &&
        candidate.assets.some((asset) => patterns.some((pattern) => pattern.test(asset.name)))
      );
      if (!release || typeof release.tag_name !== "string") continue;

      const assets = release.assets
        .filter((asset) => patterns.some((pattern) => pattern.test(asset.name)))
        .filter((asset) => asset.browser_download_url?.startsWith("https://github.com/fserlik/autumn-reader/releases/download/"))
        .sort((a, b) => {
          const rank = (asset) => patterns.findIndex((pattern) => pattern.test(asset.name));
          return rank(a) - rank(b);
        });
      updatePlatform(platform, assets, release.tag_name);
    }
  } catch {
    // El enlace estático de Windows sigue disponible sin acceso a la API.
  }
}

loadLatestInstallers();

function refreshDownloadLanguage() {
  document.querySelectorAll("[data-platform]").forEach(card => {
    const status=card.querySelector("[data-status]"); const version=card.querySelector("[data-version]"); const link=card.querySelector("[data-download]");
    const es=window.autumnI18n?.lang === "es";
    if(status) status.textContent = card.classList.contains("download-card-available") ? (es?"Disponible":"Available") : (es?"En preparación":"Coming soon");
    if(version && version.textContent) version.textContent=version.textContent.replace(/^(Versión|Version)/,es?"Versión":"Version");
    if(link && !link.hidden) { const ext=link.href.match(/\.(AppImage|exe|msi|dmg|pkg|deb|rpm)(?:$|\?)/i)?.[0]?.replace(/\?.*/,"") || ""; link.textContent=`${es?"Descargar instalador":"Download installer"} ${ext}`; }
  });
}
document.addEventListener("autumn-language-change", refreshDownloadLanguage);
