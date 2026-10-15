import { f as flowDb, p as parser$1 } from './flowDb-185abca5-CPIkoNC-.js';
import { f as flowStyles, g as flowRendererV2 } from './styles-f932cba9-kkPN82aH.js';
import { P as setConfig } from './mermaid.core-D_srWdGm.js';
import './graph-DBtqCoze.js';
import './layout-x5tGpGb9.js';
import './index-Ce3CbrDo.js';

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
