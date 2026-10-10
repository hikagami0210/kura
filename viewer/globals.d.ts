import type Panzoom from "@panzoom/panzoom";
declare global {
  var KuraPanzoom: typeof Panzoom;
  var KuraER: (source: string) => Promise<string>;
}
export {};
