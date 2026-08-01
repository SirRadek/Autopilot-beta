import React from "react";

const FIGMA_URL = /https?:\/\/(?:www\.)?figma\.com\/(?:design|file|board|proto)\/[^\s"')]+/i;

/** Pull the first Figma link out of a run's prompt, if the operator included one. */
export function extractFigmaUrl(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return FIGMA_URL.exec(text)?.[0];
}

function embedUrl(figmaUrl: string): string {
  return `https://www.figma.com/embed?embed_host=autopilot-cockpit&url=${encodeURIComponent(figmaUrl)}`;
}

export type DesignPaneProps = { readonly figmaUrl?: string };

export function DesignPane({ figmaUrl }: DesignPaneProps) {
  if (!figmaUrl) return <p className="design-pane-empty">K tomuto běhu není připojený Figma design. Vlož odkaz na frame do promptu.</p>;
  return <div className="design-pane">
    <iframe
      className="design-pane-frame"
      title="Figma design"
      src={embedUrl(figmaUrl)}
      loading="lazy"
      allowFullScreen
      referrerPolicy="no-referrer"
    />
    <a className="design-pane-link" href={figmaUrl} target="_blank" rel="noreferrer noopener">Otevřít ve Figmě ↗</a>
  </div>;
}
