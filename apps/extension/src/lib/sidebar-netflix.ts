export const SIDEBAR_WIDTH_PX = 400;

// Netflix is always dark (the host also gets .m2-dark) and the sidebar is a full-height right panel that
// reclaims space from the player (.watch-video--player-view is responsive
// and relayouts when narrowed — the Language Reactor / Jelly-Party recipe).
export const NF_CSS = `
#m2-sidebar.m2-nf {
  --m2-bg: #141414;
  position: absolute;
  top: 0;
  right: 0;
  width: ${SIDEBAR_WIDTH_PX}px;
  height: 100%;
  margin: 0;
  border-radius: 0;
  background: var(--m2-bg);
  display: flex;
  flex-direction: column;
  z-index: 20;
}
#m2-sidebar.m2-nf .m2-list {
  max-height: none;
  flex: 1;
}
`;
