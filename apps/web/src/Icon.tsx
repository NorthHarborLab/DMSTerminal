const paths = {
  folder: "M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z",
  file: "M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6",
  image: "M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M15 7h.01",
  upload: "M12 16V3M7 8l5-5 5 5M4 15v6h16v-6",
  download: "M12 3v13M7 11l5 5 5-5M4 16v5h16v-5",
  refresh: "M20 7a9 9 0 1 0 1 8M20 3v5h-5",
  up: "M12 21V3M5 10l7-7 7 7",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  list: "M3 5h2M8 5h13M3 12h2M8 12h13M3 19h2M8 19h13",
  close: "M6 6l12 12M18 6 6 18",
  settings: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  key: "M15 3a6 6 0 1 1-4 10L3 21H1v-4l8-8a6 6 0 0 1 6-6ZM16 7h.01",
  plus: "M12 4v16M4 12h16",
  link: "M9 15l6-6M8 17l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 7l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  chevron: "M9 5l7 7-7 7",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  edit: "M4 16 16 4l4 4L8 20H4ZM14 6l4 4",
  terminal: "M4 5l7 7-7 7M13 19h7",
  menu: "M3 5h18M3 12h18M3 19h18"
} as const;

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
