function isMobileDevice() {
  const ua = navigator.userAgent || navigator.vendor || "";
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  const touchTablet = navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua);
  return mobileUA || touchTablet;
}

function applyPlatformDownload() {
  const mobile = isMobileDevice();
  document.querySelectorAll("[data-desktop-download], [data-desktop-note]").forEach((element) => {
    element.hidden = mobile;
  });
  document.querySelectorAll("[data-mobile-download]").forEach((element) => {
    element.hidden = !mobile;
  });
}

document.addEventListener("DOMContentLoaded", applyPlatformDownload);
