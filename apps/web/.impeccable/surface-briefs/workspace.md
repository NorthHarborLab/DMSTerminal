# Terminal and file workspace

The workspace combines server connections, interactive terminals, remote files and theme settings

## Direction contract

THESIS: Make SSH and remote files usable in one workspace, with credentials remembered only on an explicit choice

OWN-WORLD: Inherit the existing compact sidebar, terminal tabs, dark panels and mint accent. Add complete light/dark palettes and user color overrides while retaining the same component geometry

STORY: Pick a server, choose a saved or temporary credential, confirm its fingerprint, then work in the terminal and SFTP browser with visible transfer progress

FIRST VIEWPORT: Servers at left, tabs above, terminal in the center and collapsible files at right. Files begin with path navigation and upload/new-folder actions, followed by details or thumbnails and a selected-file preview. On mobile, files become the workspace view, with servers/settings still accessible

FORM: Side-by-side terminal and file panels. Select a row to reveal metadata and preview without leaving the directory

CONSISTENCY: Share theme tokens, focus behavior, loading states and error feedback across the terminal, file panel and dialogs
