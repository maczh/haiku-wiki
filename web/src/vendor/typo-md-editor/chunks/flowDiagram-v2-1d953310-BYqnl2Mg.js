import { f as flowDb, p as parser$1 } from './flowDb-185abca5-Dx9Vp995.js';
import { f as flowStyles, g as flowRendererV2 } from './styles-f932cba9-BcCblVnA.js';
import { P as setConfig } from './mermaid.core-BzNjkjBi.js';
import './graph-C9yj4UU_.js';
import './layout-Bh5KL7Pc.js';
import './index-9eIXRZGw.js';

const diagram = {
  parser: parser$1,
  db: flowDb,
  renderer: flowRendererV2,
  styles: flowStyles,
  init: (cnf) => {
    if (!cnf.flowchart) {
      cnf.flowchart = {};
    }
    cnf.flowchart.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
    setConfig({ flowchart: { arrowMarkerAbsolute: cnf.arrowMarkerAbsolute } });
    flowRendererV2.setConf(cnf.flowchart);
    flowDb.clear();
    flowDb.setGen("gen-2");
  }
};

export { diagram };
