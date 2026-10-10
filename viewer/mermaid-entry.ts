import mermaid from "mermaid";
import Panzoom from "@panzoom/panzoom";
globalThis.KuraPanzoom = Panzoom;
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  layout: "elk",
  theme: "default",
  look: "classic",
  htmlLabels: false,
  maxTextSize: 1000000,
  er: { useMaxWidth: true },
  themeVariables: {
    primaryColor: "#edf1ff",
    primaryTextColor: "#202b3b",
    primaryBorderColor: "#91a6df",
    lineColor: "#8192b6",
    clusterBkg: "#f3f6fa",
    clusterBorder: "#c8d3e1",
    titleColor: "#55677e",
    fontFamily: "Arial, sans-serif",
  },
});
let counter = 0;
let queue: Promise<unknown> = Promise.resolve();
// Mermaid uses shared state. Serialize renders and recover after a failed graph.
globalThis.KuraER = (source) => {
  const result = queue.then(async () => {
    const { svg } = await mermaid.render("kura-er-" + ++counter, source);
    return svg;
  });
  queue = result.catch(() => {});
  return result;
};
