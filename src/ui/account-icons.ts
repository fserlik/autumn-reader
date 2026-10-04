type AccountIcon = "cloud" | "device" | "plans" | "sync" | "books" | "arrow";

const paths: Record<AccountIcon, string> = {
  cloud: '<path d="M7 18h10a4 4 0 0 0 .3-8A6 6 0 0 0 5.5 11 3.5 3.5 0 0 0 7 18Z"/>',
  device: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M9 21h6m-3-4v4"/>',
  plans: '<path d="m3 8 4.5 3L12 4l4.5 7L21 8l-2 11H5L3 8Z"/><path d="M3 8 2 5m10-1V2m9 6 1-3"/>',
  sync: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 12-2L20 12M4 12l2.5 5a7 7 0 0 0 12-2"/>',
  books: '<path d="M12 20c-2.5-2-5.5-2.5-9-2V5c3.5-.5 6.5 0 9 2 2.5-2 5.5-2.5 9-2v13c-3.5-.5-6.5 0-9 2Z"/><path d="M12 7v13M6 9c1.3 0 2.3.2 3.2.6M15 9.6c.9-.4 1.9-.6 3.2-.6"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
};

export const accountIcon = (name: AccountIcon): string =>
  `<svg class="account-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
